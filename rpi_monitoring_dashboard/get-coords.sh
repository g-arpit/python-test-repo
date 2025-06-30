#!/bin/bash

# Send proper headers first
echo "Content-type: application/json"
echo ""

# Read from configuration file
CONFIG_FILE="/var/www/camera-dashboard/conf/line-coords.json"

# Check if the file exists
if [ -f "$CONFIG_FILE" ]; then
    # Output the file contents
    cat "$CONFIG_FILE"
else
    # Return default values
    echo '{"x_position": 320}'
fi

exit 0