#!/usr/bin/env bash
set -euo pipefail

API="${BIBLIOPHILE_API:-http://localhost:8000}"
BOOKS_DIR="$(dirname "$0")/test-books"

echo "Deleting all books..."
curl -s "$API/books" \
  | python3 -c "import sys,json; [print(b['id']) for b in json.load(sys.stdin)]" \
  | xargs -r -I{} curl -s -X DELETE "$API/books/{}"

echo "Uploading books from $BOOKS_DIR..."
for f in "$BOOKS_DIR"/*.epub; do
  [[ "$f" == *Zone.Identifier* ]] && continue
  result=$(curl -s -X POST "$API/books/upload" -F "file=@$f")
  title=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['title'])")
  chapters=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['chapter_count'])")
  echo "  ✓ $title ($chapters chapters)"
done

echo "Done."
