#!/bin/bash

# Set content type to JSON
echo "Content-type: application/json"
echo ""

# Configuration file path
CONFIG_FILE="/var/www/camera-dashboard/conf/line-coords.json"
CONFIG_DIR=$(dirname "$CONFIG_FILE")

# Create directory if it doesn't exist
if [ ! -d "$CONFIG_DIR" ]; then
    mkdir -p "$CONFIG_DIR"
fi

# Read POST data
read -n $CONTENT_LENGTH POST_DATA

# Log POST data for debugging (this will appear in the error log)
echo "Received POST data: $POST_DATA" >&2

# Extract x_position value
X_POSITION=$(echo "$POST_DATA" | grep -oE 'x_position=[0-9]+' | cut -d= -f2)

# If that didn't work, try parsing JSON
if [ -z "$X_POSITION" ]; then
    X_POSITION=$(echo "$POST_DATA" | grep -oE '"x_position":[0-9]+' | grep -oE '[0-9]+')
fi

# Validate input
if [[ "$X_POSITION" =~ ^[0-9]+$ ]]; then
    # Create timestamp
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    
    # Create JSON with the coordinates and timestamp
    echo "{\"x_position\": $X_POSITION, \"updated_at\": \"$TIMESTAMP\"}" > "$CONFIG_FILE"

    sudo /usr/bin/supervisorctl restart apc >> /dev/stderr
    
    # Return success response
    echo "{\"status\": \"success\", \"message\": \"Coordinates saved and script restarted\", \"x_position\": $X_POSITION, \"updated_at\": \"$TIMESTAMP\"}"
else
    # Return error response
    echo "{\"status\": \"error\", \"message\": \"Invalid coordinate value. Received: $POST_DATA\"}"
fi

exit 0