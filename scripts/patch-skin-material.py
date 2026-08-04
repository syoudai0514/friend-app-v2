# キャラの体・顔の肌の光沢（matcap＋リムライト）だけを別のVRMから移植するツール。
# npm run dev/build の一部ではない、手動実行の保守スクリプト。
#
# 使い方: python3 scripts/patch-skin-material.py <元VRM> <対象VRM> <出力先>
#   元VRM: 肌の光沢（VRoid/Blenderで調整済み）を持つ参照用VRM
#   対象VRM: 実際に配信しているキャラの衣装バリアント（public/vrm/<id>/<variant>.vrm）
#   出力先: 生成物のパス。中身を確認してから対象VRMへ上書きする（直接上書きしない）
#
# 例（2026-08-04、しずくの肌に光沢のあるmatcapを反映した際に使用）:
#   for f in casual fftifa knit leather; do
#     python3 scripts/patch-skin-material.py \
#       shizuku_gloss_reference.vrm public/vrm/shizuku/$f.vrm /tmp/$f.patched.vrm
#   done
#
# 【重要】最初のバージョンはBody_00_SKIN/Face_00_SKINマテリアルを丸ごと
# 差し替えていたが、これは事故った。マテリアル全体を差し替えると
# baseColorTexture（肌の色・柄そのもの）まで元VRMのものに変わってしまい、
# ①衣装ごとに微妙に異なる肌の柄（FFVティファは腕・脚の露出部分の柄が
# 他の衣装と違う）が消え、参照側の柄が透けて見えた、②FFVティファでは
# さらに、なぜか脚のニーハイの見た目まで崩れた（別メッシュのはずが、
# alphaMode/doubleSided等マテリアルの他プロパティ変更の副作用で
# 描画が乱れたとみられる。原因を完全には特定できていない）。
# そのため今のバージョンは光沢に直接関係するプロパティ
# （matcapFactor・matcapTexture・rimLightingMixFactor・
# parametricRimColorFactor・parametricRimFresnelPowerFactor・
# parametricRimLiftFactor）だけを個別に上書きし、baseColorTexture・
# normalTexture・emissiveTexture・shadeMultiplyTexture・
# shadeColorFactor・shadingShift/ToonyFactor・alphaMode・doubleSided等、
# 肌の柄や他の描画設定には一切触れない。差し替える前に対象VRMの
# baseColorTextureのバイト列を確認し、パッチ後も不変であることを
# 確認すること（これで柄が消えていないと機械的に検証できる）。
import json
import struct
import sys
import copy

SKIN_MATERIAL_NAMES = [
    "N00_000_00_Body_00_SKIN (Instance)",
    "N00_000_00_Face_00_SKIN (Instance)",
]

GLOSS_SCALAR_KEYS = [
    "matcapFactor",
    "rimLightingMixFactor",
    "parametricRimColorFactor",
    "parametricRimFresnelPowerFactor",
    "parametricRimLiftFactor",
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


def copy_texture(src_gltf, src_bin, tgt_gltf, tgt_bin, src_tex_idx):
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
    tgt_gltf["bufferViews"].append({"buffer": 0, "byteOffset": new_offset, "byteLength": length})

    new_img_idx = len(tgt_gltf["images"])
    new_img = dict(src_img)
    new_img["bufferView"] = new_bv_idx
    tgt_gltf["images"].append(new_img)

    new_tex_idx = len(tgt_gltf["textures"])
    tgt_gltf["textures"].append({"sampler": 0, "source": new_img_idx})
    return new_tex_idx


def patch(src_path, target_path, out_path):
    src_gltf, src_bin = load_glb(src_path)
    tgt_gltf, tgt_bin = load_glb(target_path)

    src_materials = {
        m["name"]: m for m in src_gltf["materials"] if m["name"] in SKIN_MATERIAL_NAMES
    }
    tgt_materials = {
        m["name"]: m for m in tgt_gltf["materials"] if m["name"] in SKIN_MATERIAL_NAMES
    }
    assert set(src_materials) == set(SKIN_MATERIAL_NAMES), "元VRMに肌マテリアルが見つからない"
    assert set(tgt_materials) == set(SKIN_MATERIAL_NAMES), "対象VRMに肌マテリアルが見つからない"

    for name in SKIN_MATERIAL_NAMES:
        src_mtoon = src_materials[name]["extensions"]["VRMC_materials_mtoon"]
        tgt_mtoon = tgt_materials[name]["extensions"]["VRMC_materials_mtoon"]

        for key in GLOSS_SCALAR_KEYS:
            tgt_mtoon[key] = copy.deepcopy(src_mtoon[key])

        src_matcap_idx = src_mtoon["matcapTexture"]["index"]
        new_idx = copy_texture(src_gltf, src_bin, tgt_gltf, tgt_bin, src_matcap_idx)
        tgt_mtoon["matcapTexture"] = {"index": new_idx}
        print(f"  {name}: matcapTexture -> {new_idx}, gloss factors copied")

    tgt_gltf["buffers"][0]["byteLength"] = len(tgt_bin)
    save_glb(out_path, tgt_gltf, tgt_bin)
    print(f"wrote {out_path} ({len(tgt_bin)} bytes bin)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__ or "usage: patch-skin-material.py <src.vrm> <target.vrm> <out.vrm>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2], sys.argv[3])
