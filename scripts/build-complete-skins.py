# 借り物衣装のときに使う「穴のない体テクスチャ」を作るツール。
# npm run dev/build の一部ではない、手動実行の保守スクリプト
# （画像合成にPillowが要るため、Vercelのビルド環境に依存させたくない。
#  生成物 public/skin/<personaId>.webp をコミットして配信する）。
#
# 使い方: python3 scripts/build-complete-skins.py
#
# 【なぜ必要か】
# VRoidは「服の下に隠れる体」をジオメトリではなく**テクスチャのアルファ**で消す。
# Body_00_SKIN は alphaMode=MASK なので、alpha=0 のテクセルは描画されず穴になる。
# 自分の衣装を着ているうちはその服がちょうど覆うので見えないが、
# 借り物の服は覆う範囲が違うため、欠損部が露出してギザギザの穴として見える
# （なぎがアイミーのオフショルニットを着ると胸元が破れて見えるのがこれ）。
#
# 実測した透明率:
#   aimi/knit, aimi/swimsuit               0.0%  完全
#   shizuku/fftifa, knit, leather          0.0%  完全
#   shizuku/casual                         7.3%
#   rena/default, casual, work            13.0%  どれも欠損（高さ1.2mの帯が94%）
#   nagi/default                          24.6%  唯一の衣装が欠損（高さ1.1〜1.3m）
#   aimi/shirt                            49.6%
#
# 【方針】
# 1. そのキャラ自身の衣装の中で透明率が最小のものを土台にする
#    （本人の柄・下着・陰影がそのまま残るので一番正しい）
# 2. まだ穴が残るなら、完全なテクスチャ（DONOR）の同じUV位置から埋める。
#    4キャラとも体のUVレイアウトは同一（VRoid標準。N00系=アイミー/しずく と
#    F00系=なぎ/れな で解像度は違うがUV島の位置は一致）なので、
#    下着や陰影が正しい位置に入る。肌の色は提供元→本人へ比率変換する。
import json
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillowが要ります: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
VRM_DIR = ROOT / "public" / "vrm"
OUT_DIR = ROOT / "public" / "skin"

# src/components/character/CharacterStage.tsx の BODY_SKIN_COLORS と同じ値。
# 各キャラのBody_00_SKINベーステクスチャの肌色ピクセルの中央値から算出したもの。
SKIN_COLORS = {
    "aimi": (0xF9, 0xE7, 0xD9),
    "shizuku": (0xE2, 0xC2, 0x9F),
    "nagi": (0xCB, 0x97, 0x71),
    "rena": (0xF2, 0xC7, 0xB2),
}

# 穴埋めの提供元。完全（透明率0%）で、肌の色が極端でないものを選ぶ。
DONOR = ("shizuku", "knit")

# 土台に使う衣装を明示指定する。指定が無いキャラは下の自動選択にまかせる。
# **必ず目で見て決めること**——数値指標だけだと衣装の焼き込みを見抜けない。
#   shizuku: 自動だとleatherが選ばれるが、胸に大きな黒いレオタード状の面と
#            トゲ状のストラップが焼き込まれていて、借りた服の襟ぐりから
#            はみ出すと不自然。knitは小さなブラだけなので下着として自然。
#   aimi:    swimsuitが自動でも選ばれる。素肌＋黒い下着で一番きれい。
PREFERRED_BASE = {
    "shizuku": "knit",
    "aimi": "swimsuit",
}

# これ以下のアルファを「消されている」とみなす
CLEAR_ALPHA = 10


def load_glb(path):
    data = path.read_bytes()
    magic, _version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"{path} is not a glb"
    offset = 12
    gltf = None
    binc = None
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == b"JSON":
            gltf = json.loads(chunk)
        elif chunk_type == b"BIN\x00":
            binc = chunk
        offset += 8 + chunk_len
    return gltf, binc


def body_texture(path):
    """VRMからBody_00_SKINのbaseColorTextureをRGBA画像として取り出す"""
    gltf, binc = load_glb(path)
    for material in gltf.get("materials", []):
        if "Body_00_SKIN" not in material.get("name", ""):
            continue
        texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not texture:
            continue
        image = gltf["images"][gltf["textures"][texture["index"]]["source"]]
        view = gltf["bufferViews"][image["bufferView"]]
        start = view.get("byteOffset", 0)
        blob = bytes(binc[start : start + view["byteLength"]])
        from io import BytesIO

        return Image.open(BytesIO(blob)).convert("RGBA")
    return None


def is_skin_pixel(r, g, b):
    """肌に当たる色かどうか（VrmModel.tsxのisSkinPixelと同じ条件）"""
    return not (r < 65 or g < 45 or b < 35 or r - g < 4 or g - b < 2)


def clear_ratio(image):
    alpha = image.getchannel("A")
    small = alpha.resize((256, 256))
    pixels = list(small.getdata())
    return sum(1 for value in pixels if value <= CLEAR_ALPHA) / len(pixels)


def skin_ratio(image):
    """不透明な範囲のうち肌色が占める割合。
    衣装が体テクスチャに焼き込まれている衣装（しずくのFFVティファは黒いニーハイや
    サスペンダーがBody側に入っている）を土台に選ばないための指標。"""
    small = image.resize((256, 256))
    pixels = list(small.getdata())
    opaque = [p for p in pixels if p[3] > CLEAR_ALPHA]
    if not opaque:
        return 0.0
    return sum(1 for r, g, b, _ in opaque if is_skin_pixel(r, g, b)) / len(opaque)


def recolor(image, source_rgb, target_rgb):
    """提供元の肌色を本人の肌色へ比率変換する（VrmModel.tsxのrecolorBodyTextureと同じ式）"""
    if source_rgb == target_rgb:
        return image
    ratios = [target_rgb[i] / source_rgb[i] for i in range(3)]
    out = image.copy()
    pixels = out.load()
    width, height = out.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # 白い靴下や黒い下着は残し、肌に当たる色だけ寄せる（同上の判定条件）
            if r < 65 or g < 45 or b < 35 or r - g < 4 or g - b < 2:
                continue
            pixels[x, y] = (
                min(255, round(r * ratios[0])),
                min(255, round(g * ratios[1])),
                min(255, round(b * ratios[2])),
                a,
            )
    return out


def main():
    donor_path = VRM_DIR / DONOR[0] / f"{DONOR[1]}.vrm"
    donor_raw = body_texture(donor_path)
    if donor_raw is None:
        sys.exit(f"提供元の体テクスチャが読めません: {donor_path}")
    donor_ratio = clear_ratio(donor_raw)
    if donor_ratio > 0.001:
        sys.exit(f"提供元 {DONOR[0]}/{DONOR[1]} に穴があります（透明率{donor_ratio:.1%}）")
    print(f"提供元: {DONOR[0]}/{DONOR[1]}  {donor_raw.size}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for persona_dir in sorted(p for p in VRM_DIR.iterdir() if p.is_dir()):
        persona = persona_dir.name
        candidates = []
        for vrm in sorted(persona_dir.glob("*.vrm")):
            image = body_texture(vrm)
            if image is None:
                continue
            candidates.append((clear_ratio(image), skin_ratio(image), vrm.stem, image))
        if not candidates:
            continue
        # 穴が少ないものを優先し、同程度なら肌が広く残っているものを選ぶ。
        # 透明率だけで選ぶと、しずくはFFVティファ（黒いニーハイやサスペンダーが
        # Body側に焼き込まれている）が土台になってしまい、何を借りても脚が黒くなる。
        candidates.sort(key=lambda c: (round(c[0], 2), -c[1]))
        preferred = PREFERRED_BASE.get(persona)
        chosen = next((c for c in candidates if c[2] == preferred), candidates[0])
        ratio, skin, variant, base = chosen
        detail = f"{persona:<8} 土台={variant:<10} 透明率{ratio:>6.1%} 肌率{skin:>6.1%}"

        if ratio > 0.001:
            # 本人に完全なテクスチャが無いので、提供元の同じUV位置から埋める
            filler = donor_raw
            if filler.size != base.size:
                filler = filler.resize(base.size, Image.LANCZOS)
            filler = recolor(filler, SKIN_COLORS[DONOR[0]], SKIN_COLORS[persona])
            # アルファが立っている所は本人、消えている所だけ提供元
            mask = base.getchannel("A").point(lambda v: 255 if v > CLEAR_ALPHA else 0)
            merged = Image.composite(base, filler, mask)
            detail += f"  -> {DONOR[0]}から穴埋め"
        else:
            merged = base
            detail += "  -> そのまま"

        # MASKで弾かれないよう全面を不透明にする
        merged = merged.convert("RGB")
        out = OUT_DIR / f"{persona}.webp"
        merged.save(out, "WEBP", quality=90, method=6)
        print(f"{detail}  -> public/skin/{persona}.webp ({out.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
