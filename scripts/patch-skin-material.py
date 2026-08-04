# キャラの体・顔の肌マテリアル（_SKIN）だけを別のVRMから移植するツール。
# npm run dev/build の一部ではない、手動実行の保守スクリプト。
#
# 使い方: python3 scripts/patch-skin-material.py <元VRM> <対象VRM> <出力先>
#   元VRM: 肌マテリアル（VRoid/Blenderで調整済み）を持つ参照用VRM
#   対象VRM: 実際に配信しているキャラの衣装バリアント（public/vrm/<id>/<variant>.vrm）
#   出力先: 生成物のパス。中身を確認してから対象VRMへ上書きする（直接上書きしない）
#
# 例（2026-08-04、しずくの肌に光沢のあるmatcapを反映した際に使用）:
#   for f in casual fftifa knit leather; do
#     python3 scripts/patch-skin-material.py \
#       shizuku_gloss_reference.vrm public/vrm/shizuku/$f.vrm /tmp/$f.patched.vrm
#   done
#
# 仕組み: 対象VRMのバッファ末尾に元VRMの肌テクスチャ画像だけを追記し、
# images/textures/bufferViewsへ新しいエントリを追加、Body_00_SKINと
# Face_00_SKINのマテリアルJSONを丸ごと元VRMのものに差し替えて（テクスチャ参照は
# 追記した新エントリへ付け替える）保存する。既存のメッシュ・アクセサ・他マテリアルの
# インデックスは一切変更しないので、服・髪・顔の他パーツには影響しない
# （元の肌テクスチャは未参照のまま残り、ファイルサイズはやや増える）。
#
# 前提: 対象・元の両VRMでsamplers[0]がrepeat/linearの共通設定であること
# （このプロジェクトのVRoid書き出しはどれも該当）。異なる場合はサンプラーも
# 複製するようcollect/remap関数を拡張すること。
import json
import struct
import sys
import copy

SKIN_MATERIAL_NAMES = [
    "N00_000_00_Body_00_SKIN (Instance)",
    "N00_000_00_Face_00_SKIN (Instance)",
]

MTOON_TEXTURE_KEYS = [
    "shadeMultiplyTexture",
    "matcapTexture",
    "rimMultiplyTexture",
    "outlineWidthMultiplyTexture",
    "uvAnimationMaskTexture",
]


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"{path} is not a glb"
    offset = 12
    json_chunk = None
    bin_chunk = None
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        chunk_data = data[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            json_chunk = chunk_data
        elif chunk_type == b"BIN\x00":
            bin_chunk = bytearray(chunk_data)
        offset += 8 + chunk_len
    return json.loads(json_chunk), bin_chunk


def save_glb(path, gltf, bin_bytes):
    json_bytes = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * pad

    bin_bytes = bytes(bin_bytes)
    pad_b = (4 - len(bin_bytes) % 4) % 4
    bin_bytes += b"\x00" * pad_b

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


def collect_texture_indices(material):
    idxs = set()
    pbr = material.get("pbrMetallicRoughness", {})
    if "baseColorTexture" in pbr:
        idxs.add(pbr["baseColorTexture"]["index"])
    for key in ["normalTexture", "emissiveTexture", "occlusionTexture"]:
        if key in material:
            idxs.add(material[key]["index"])
    mtoon = material.get("extensions", {}).get("VRMC_materials_mtoon", {})
    for key in MTOON_TEXTURE_KEYS:
        if key in mtoon:
            idxs.add(mtoon[key]["index"])
    return idxs


def remap_texture_refs(material, mapping):
    pbr = material.get("pbrMetallicRoughness", {})
    if "baseColorTexture" in pbr:
        pbr["baseColorTexture"]["index"] = mapping[pbr["baseColorTexture"]["index"]]
    for key in ["normalTexture", "emissiveTexture", "occlusionTexture"]:
        if key in material:
            material[key]["index"] = mapping[material[key]["index"]]
    mtoon = material.get("extensions", {}).get("VRMC_materials_mtoon", {})
    for key in MTOON_TEXTURE_KEYS:
        if key in mtoon:
            mtoon[key]["index"] = mapping[mtoon[key]["index"]]


def patch(src_path, target_path, out_path):
    src_gltf, src_bin = load_glb(src_path)
    tgt_gltf, tgt_bin = load_glb(target_path)

    src_materials = {
        m["name"]: m for m in src_gltf["materials"] if m["name"] in SKIN_MATERIAL_NAMES
    }
    missing = set(SKIN_MATERIAL_NAMES) - set(src_materials.keys())
    assert not missing, f"source missing materials: {missing}"

    tgt_names = {m["name"] for m in tgt_gltf["materials"]}
    missing_tgt = set(SKIN_MATERIAL_NAMES) - tgt_names
    assert not missing_tgt, f"{target_path} missing materials: {missing_tgt}"

    needed_tex_idxs = set()
    for m in src_materials.values():
        needed_tex_idxs |= collect_texture_indices(m)

    mapping = {}
    for src_tex_idx in sorted(needed_tex_idxs):
        src_tex = src_gltf["textures"][src_tex_idx]
        src_img = src_gltf["images"][src_tex["source"]]
        src_bv = src_gltf["bufferViews"][src_img["bufferView"]]
        start = src_bv.get("byteOffset", 0)
        length = src_bv["byteLength"]
        img_bytes = bytes(src_bin[start : start + length])

        pad = (4 - len(tgt_bin) % 4) % 4
        tgt_bin.extend(b"\x00" * pad)
        new_offset = len(tgt_bin)
        tgt_bin.extend(img_bytes)

        new_bv_idx = len(tgt_gltf["bufferViews"])
        tgt_gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": new_offset, "byteLength": length}
        )

        new_img_idx = len(tgt_gltf["images"])
        new_img = dict(src_img)
        new_img["bufferView"] = new_bv_idx
        tgt_gltf["images"].append(new_img)

        new_tex_idx = len(tgt_gltf["textures"])
        tgt_gltf["textures"].append({"sampler": 0, "source": new_img_idx})

        mapping[src_tex_idx] = new_tex_idx
        print(f"  copied texture {src_tex_idx} ({src_img.get('name')}) -> {new_tex_idx}")

    for name in SKIN_MATERIAL_NAMES:
        new_mat = copy.deepcopy(src_materials[name])
        remap_texture_refs(new_mat, mapping)
        for i, m in enumerate(tgt_gltf["materials"]):
            if m["name"] == name:
                tgt_gltf["materials"][i] = new_mat
                break

    tgt_gltf["buffers"][0]["byteLength"] = len(tgt_bin)
    save_glb(out_path, tgt_gltf, tgt_bin)
    print(f"wrote {out_path} ({len(tgt_bin)} bytes bin)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__ or "usage: patch-skin-material.py <src.vrm> <target.vrm> <out.vrm>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2], sys.argv[3])
