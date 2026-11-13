from pathlib import Path
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "menu"

ITEMS = {
    "5-pcs-crispy-chicken": "single-fried-chicken",
    "5-pcs-bucket": "wings",
    "breakfast-meal": "lunch-meal",
    "mayonnaise-medium": "cheese-balls",
    "kings-kebab-wrap-roll": "kings-zinger-wrap-roll",
    "kings-prime-sandwich": "kings-zinger-sandwich",
    "3-plus-2-combo": "lunch-meal",
    "nano-burger": "kings-jr-burger",
    "5-pcs-combo": "dora-meal",
    "students-combo": "kings-mix-sandwich",
    "10-pcs-combo": "lunch-meal",
    "9-pcs-bucket": "chick-pop",
    "kings-mixed-wrap-roll": "kings-zinger-wrap-roll",
    "9-pcs-crispy-chicken": "single-fried-chicken",
    "mayonnaise-large": "cheese-balls",
    "prime-combo": "kings-prime-burger",
    "chota-bheem-meal": "dora-meal",
    "friends-meal": "honey-bunny-meal",
    "12-pcs-crispy-chicken": "single-fried-chicken",
    "coleslaw-medium": "cheese-balls",
    "20-pcs-combo": "lunch-meal",
    "12-pcs-bucket": "wings",
    "king-zinger-combo": "kings-zinger-burger",
    "coleslaw-large": "cheese-balls",
    "18-pcs-crispy-chicken": "single-fried-chicken",
    "kings-meal": "honey-bunny-meal",
    "18-pcs-bucket": "wings",
    "30-pcs-combo": "lunch-meal",
    "kings-shrimps-sandwich": "kings-prawns-burger",
    "friends-strips": "chicken-strips",
    "2-prime-combo": "kings-prime-burger",
    "family-meal": "lunch-meal",
    "kings-shrimps-wrap-roll": "kings-crab-wrap-roll",
    "bun": "kings-veg-burger",
    "kings-loaded-sandwich": "kings-mix-sandwich",
    "mega-family-meal": "lunch-meal",
    "wheat-kuboos": "kings-veg-wrap-roll",
    "kings-club-sandwich": "kings-zinger-sandwich",
    "kings-party-meal": "lunch-meal",
    "kitty-party-meal": "dora-meal",
}

def make_variant(source: Image.Image, index: int) -> Image.Image:
    image = source.convert("RGB").resize((640, 640), Image.Resampling.LANCZOS)
    zoom = 1.02 + (index % 4) * 0.012
    size = int(640 / zoom)
    left = (640 - size) // 2
    image = image.crop((left, left, left + size, left + size)).resize(
        (640, 640), Image.Resampling.LANCZOS
    )
    image = ImageEnhance.Contrast(image).enhance(1.02 + (index % 3) * 0.02)
    image = ImageEnhance.Color(image).enhance(0.98 + (index % 5) * 0.025)
    image = ImageEnhance.Brightness(image).enhance(0.97 + (index % 4) * 0.015)
    return image


def main() -> None:
    for index, (slug, source_slug) in enumerate(ITEMS.items()):
        source = Image.open(SOURCE / f"{source_slug}.webp")
        output = make_variant(source, index)
        output.save(SOURCE / f"{slug}.webp", "WEBP", quality=88, method=6)
    print(f"Generated {len(ITEMS)} menu images.")


if __name__ == "__main__":
    main()
