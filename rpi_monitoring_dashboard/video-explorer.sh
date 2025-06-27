#!/bin/bash

LOG_FILE="/tmp/list_dir_debug.log"

# Custom logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

log "Script called with QUERY_STRING=$QUERY_STRING"

echo "Content-type: application/json"
echo ""

DIR_BASE="/home/chalopi/apc/output_videos/"

QUERY_STRING=$(echo "$QUERY_STRING" | sed 's/%2F/\//g')
REL_PATH=$(echo "$QUERY_STRING" | sed 's/^path=//')
TARGET_DIR="$DIR_BASE${REL_PATH#$DIR_BASE}"

log "Parsed path: $TARGET_DIR"

if [ ! -d "$TARGET_DIR" ]; then
    log "Directory not found: $TARGET_DIR"
    echo "[]"
    exit 0
fi

echo "["
FIRST=true
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 | while read item; do
    [ -e "$item" ] || continue
    name=$(basename "$item")

    if [[ -d "$item" ]]; then
        [ "$FIRST" = true ] && FIRST=false || echo ","
        log "Found directory: $name"
        echo "{\"name\":\"$name\",\"type\":\"directory\"}"
    elif [[ "$item" == *.mp4 ]]; then
        [ "$FIRST" = true ] && FIRST=false || echo ","
        log "Found file: $name"
        echo "{\"name\":\"$name\",\"type\":\"file\"}"
    fi
done
echo "]"
