# 服（_CLOTH）マテリアルに焼き込まれた光沢（matcap）だけを無効化するツール。
# npm run dev/build の一部ではない、手動実行の保守スクリプト。
#
# 背景: VRoid/Blenderからの元エクスポート時点で、アイミー・しずくの一部の
# 衣装は服マテリアルにも艶のあるmatcapFactor=[1,1,1]が入っていた（肌の光沢とは
# 無関係に、アーティスト側の書き出し設定で入っていたもの）。「光沢は肌だけに
# したい」という方針に合わせ、服マテリアルのmatcapFactorだけを[0,0,0]にする。
# matcapTextureそのものの参照やbaseColorTexture・alphaMode等、他のプロパティは
# 一切変更しない（BINチャンクは完全に無傷のまま、JSONチャンクの数値だけを書き換える）。
#
# 使い方: python3 scripts/strip-cloth-gloss.py <対象VRM> [<対象VRM> ...]
# 対象ファイルへ直接上書きする（このスクリプトはテクスチャを追加しないので
# 複数回実行しても副作用は無く、再実行しても同じ結果になる）。
import json
import struct
import sys


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


def strip(path):
    gltf, binc = load_glb(path)
    changed = 0
    for material in gltf.get("materials", []):
        if "_CLOTH" not in material["name"]:
            continue
        mtoon = material.get("extensions", {}).get("VRMC_materials_mtoon")
        if not mtoon or "matcapFactor" not in mtoon:
            continue
        if mtoon["matcapFactor"] == [0, 0, 0]:
            continue
        mtoon["matcapFactor"] = [0, 0, 0]
        changed += 1
    if changed == 0:
        print(f"skip {path}: 服の光沢なし")
        return
    save_glb(path, gltf, binc)
    print(f"wrote {path}: {changed}件のmatcapFactorを[0,0,0]に")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__ or "usage: strip-cloth-gloss.py <vrm> [<vrm> ...]")
        sys.exit(1)
    for target in sys.argv[1:]:
        strip(target)
