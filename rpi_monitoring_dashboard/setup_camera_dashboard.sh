#!/bin/bash

# Setup script for RPi Camera Dashboard
# This script installs and configures all necessary components to display
# refreshed camera frames instead of video stream

echo "Starting RPi Camera Dashboard setup..."

source /tmp/camera.env

# Exit on error
set -e

# Variables
INSTALL_DIR="/var/www/camera-dashboard"
NGINX_CONF="/etc/nginx/sites-available/camera-dashboard"
CGI_DIR="$INSTALL_DIR/cgi-bin"
CONF_DIR="$INSTALL_DIR/conf"
FRAMES_DIR="$INSTALL_DIR/frames"
METRICS_DIR="$INSTALL_DIR/metrics"

# Check if camera IP is provided
if [ -z "$CAMERA_IP" ]; then
    echo "Error: Camera IP address not provided."
    echo "Usage: $0 <camera_ip>"
    exit 1
fi

echo "Camera IP: $CAMERA_IP"

# Install required packages
echo "Installing required packages..."
apt-get update
apt-get install -y nginx fcgiwrap ffmpeg
apt-get install -y imagemagick

# Create required directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CGI_DIR"
mkdir -p "$CONF_DIR"
mkdir -p "$FRAMES_DIR"
mkdir -p "$METRICS_DIR"


# Set permissions early to ensure ffmpeg can write to frames directory
chown -R www-data:www-data "$FRAMES_DIR"
chmod -R 755 "$FRAMES_DIR"
chown -R www-data:www-data "$INSTALL_DIR"
chmod -R 755 "$INSTALL_DIR"
chown -R www-data:www-data "$METRICS_DIR"
chmod -R 755 "$METRICS_DIR"

# Create default configuration
echo "Creating default configuration..."
echo '{"x_position": 320}' > "$CONF_DIR/line-coords.json"

# Create CGI scripts
echo "Creating CGI scripts..."
cp "./get-coords.sh" "$CGI_DIR"
cp "./save-coords.sh" "$CGI_DIR"
cp "./video-explorer.sh" "$CGI_DIR"

#Creating assets
cp "./styles.css" "$INSTALL_DIR"
cp "./script.js" "$INSTALL_DIR"

# Make scripts executable and fix permissions
chmod +x "$CGI_DIR/get-coords.sh" "$CGI_DIR/save-coords.sh" "$CGI_DIR/video-explorer.sh"
chown www-data:www-data "$CGI_DIR/get-coords.sh" "$CGI_DIR/save-coords.sh" "$CGI_DIR/video-explorer.sh"

#Change directory permission for video-explorer.sh
chmod o+rx /home
chmod o+rx /home/chalopi
chmod o+rx /home/chalopi/apc
chmod o+rx /home/chalopi/apc/output_videos


# Create Nginx config
echo "Setting up Nginx configuration..."
cp "./nginx-conf" "$NGINX_CONF"

# Enable site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/

# Create HTML file
echo "Creating dashboard HTML..."
cat "./dashboard.html" > "$INSTALL_DIR/index.html"

# Create new CGI scripts for camera control
cat > "$CGI_DIR/camera-control.sh" << 'EOL'
#!/bin/bash

# CGI script for camera service control
echo "Content-Type: application/json"
echo ""

# Read the request method and query string
REQUEST_METHOD="${REQUEST_METHOD:-GET}"
QUERY_STRING="${QUERY_STRING:-}"

# Function to get service status
get_status() {
    echo "[CGI] Checking camera service status" >> /tmp/camera_debug.log
    sudo /bin/systemctl is-active --quiet camera-frame-capture.service >> /tmp/camera_debug.log 2>&1
    if sudo /bin/systemctl is-active --quiet camera-frame-capture.service; then
        echo '{"status": "running", "message": "Camera capture service is running"}'
    else
        echo '{"status": "stopped", "message": "Camera capture service is stopped"}'
    fi
}

# Function to start service
start_service() {
    echo "[CGI] Starting camera-frame-capture.service - systemctl start camera-frame-capture.service" >> /tmp/camera_debug.log
    sudo /bin/systemctl start camera-frame-capture.service >> /tmp/camera_debug.log 2>&1
    if [ $? -eq 0 ]; then
        echo '{"status": "success", "message": "Camera capture service started successfully"}'
    else
        echo '{"status": "error", "message": "Failed to start camera capture service"}'
    fi
}

# Function to stop service
stop_service() {
    echo "[CGI] Stopping camera-frame-capture.service" >> /tmp/camera_debug.log
    sudo /bin/systemctl stop camera-frame-capture.service >> /tmp/camera_debug.log 2>&1
    RESULT=$?
    echo "[CGI] stop result: $RESULT" >> /tmp/camera_debug.log
    if [ $RESULT -eq 0 ]; then
        echo '{"status": "success", "message": "Camera capture service stopped successfully"}'
    else
        echo '{"status": "error", "message": "Failed to stop camera capture service"}'
    fi
}


# Parse action from query string
ACTION=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')

case "$ACTION" in
    "start")
        start_service
        ;;
    "stop")
        stop_service
        ;;
    "status"|"")
        get_status
        ;;
    *)
        echo '{"status": "error", "message": "Invalid action. Use start, stop, or status"}'
        ;;
esac
EOL

chmod +x "$CGI_DIR/camera-control.sh"
chown www-data:www-data "$CGI_DIR/camera-control.sh"

# Create frame capture script
echo "Creating frame capture script..."
cat > "$INSTALL_DIR/capture-frame.sh" << EOL
#!/bin/bash

source /tmp/camera.env

# Settings
FRAMES_DIR="$FRAMES_DIR"
TIMESTAMP=\$(date +"%Y%m%d%H%M%S")

# Ensure frames directory exists
mkdir -p "\$FRAMES_DIR"

# Log file for debugging
LOG_FILE="\$FRAMES_DIR/capture.log"

echo "[\$TIMESTAMP] Starting frame capture" >> "\$LOG_FILE"
echo "[$(date)] CAMERA_IP from env: \$CAMERA_IP" >> "\$LOG_FILE"

# Capture a single frame from the RTSP stream with more reliable settings
# Add timeout to prevent hanging if camera is unreachable
ffmpeg -y -rtsp_transport tcp -i $RTSP_URL \\
    -vframes 1 \\
    -update 1 \\
    -f image2 \\
    "\$FRAMES_DIR/current.jpg" 2>> "\$LOG_FILE"

RESULT=\$?
if [ \$RESULT -ne 0 ]; then
    echo "[\$TIMESTAMP] Error: ffmpeg failed with exit code \$RESULT" >> "\$LOG_FILE"
    # Create a simple error image if capture fails
    echo "<svg width='640' height='480' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' fill='black'/><text x='50%' y='50%' font-family='Arial' font-size='20' fill='red' text-anchor='middle'>Camera Connection Error</text></svg>" > "\$FRAMES_DIR/error.svg"
    convert "\$FRAMES_DIR/error.svg" "\$FRAMES_DIR/current.jpg" 2>> "\$LOG_FILE" || true
else
    echo "[\$TIMESTAMP] Frame captured successfully" >> "\$LOG_FILE"
    
    # Check if the captured file exists and has content
    if [ -s "\$FRAMES_DIR/current.jpg" ]; then
        # Keep a limited history of frames
        cp "\$FRAMES_DIR/current.jpg" "\$FRAMES_DIR/frame_\${TIMESTAMP}.jpg"
    else
        echo "[\$TIMESTAMP] Warning: Captured file is empty" >> "\$LOG_FILE"
    fi
fi

# Remove old frames (keep only the last 10)
ls -t "\$FRAMES_DIR"/frame_*.jpg | tail -n +11 | xargs rm -f 2>/dev/null || true

# Cleanup old logs (keep last 100 lines)
tail -n 100 "\$LOG_FILE" > "\$LOG_FILE.tmp" && mv "\$LOG_FILE.tmp" "\$LOG_FILE"

# Set proper permissions
chmod 644 "\$FRAMES_DIR"/*.jpg || true
echo "Frame capture completed at \$(date)" >> "\$LOG_FILE"
EOL

chmod +x "$INSTALL_DIR/capture-frame.sh"

# Create systemd service for frame capture
echo "Creating systemd service for frame capture..."
cat > /etc/systemd/system/camera-frame-capture.service << EOL
[Unit]
Description=Camera Frame Capture Service
After=network.target

[Service]
Type=simple
ExecStart=/bin/bash -c "while true; do $INSTALL_DIR/capture-frame.sh; sleep 1; done"
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOL

# Create a test image file to ensure something shows up even if camera fails
echo "Creating test image..."
cat > "$FRAMES_DIR/test_frame.svg" << 'EOL'
<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="black"/>
  <text x="50%" y="240" font-family="Arial" font-size="24" fill="white" text-anchor="middle">Testing Camera Connection...</text>
  <text x="50%" y="280" font-family="Arial" font-size="18" fill="yellow" text-anchor="middle">If you see this image, camera frames are not being captured.</text>
</svg>
EOL

# Try to convert the SVG to JPG for the first frame
if command -v convert >/dev/null 2>&1; then
    convert "$FRAMES_DIR/test_frame.svg" "$FRAMES_DIR/current.jpg" || cp "$FRAMES_DIR/test_frame.svg" "$FRAMES_DIR/current.jpg"
else
    cp "$FRAMES_DIR/test_frame.svg" "$FRAMES_DIR/current.jpg"
fi

# Configuring monito script
TARGET_DIR="/var/lib/pi_monitor"

# 1. Create target directory
echo "Creating $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

# 2. Copy files to /var/lib/pi_monitor
echo "Copying pi_monitor.py and pi_monitor.service to $TARGET_DIR..."
cp "./pi_monitor.py" "$TARGET_DIR/"
cp "./pi_monitor.service" "$TARGET_DIR/"

# 3. Copy pi_monitor.py to /usr/local/bin
echo "Copying pi_monitor.py to /usr/local/bin..."
cp "./pi_monitor.py" /usr/local/bin/pi_monitor.py
chmod +x /usr/local/bin/pi_monitor.py

# 4. Copy pi_monitor.service to systemd
echo "Copying pi_monitor.service to /etc/systemd/system/..."
cp "./pi_monitor.service" /etc/systemd/system/pi_monitor.service

#Updating sudoers to enable restarting apc thru www-data
SUDOERS_LINE="www-data ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl restart apc, /bin/systemctl start camera-frame-capture.service, /bin/systemctl stop camera-frame-capture.service, /bin/systemctl is-active --quiet camera-frame-capture.service, /bin/cp /home/chalopi/apc/output_videos/* /var/www/camera-dashboard/videos/, /usr/bin/xargs"
echo "[INFO] Adding sudoers rule..."

# Check if the line already exists
if sudo grep -Fxq "$SUDOERS_LINE" /etc/sudoers; then
    echo "[INFO] Sudoers rule already exists."
else
    echo "$SUDOERS_LINE" | sudo EDITOR='tee -a' visudo
    echo "[INFO] Sudoers rule added."
fi

# Enable and start services
echo "Starting services..."
systemctl daemon-reload
systemctl enable camera-frame-capture.service

systemctl enable pi_monitor.service
systemctl restart pi_monitor.service

rm -rf /etc/nginx/sites-enabled/default 
systemctl restart nginx

echo "Running initial frame capture..."
"$INSTALL_DIR/capture-frame.sh"

echo "Setup complete!"
echo "Access the dashboard at http://$(hostname -I | awk '{print $1}')"
echo "The RTSP stream is available at rtsp://admin:@${CAMERA_IP}:554/ch0_1.264"
echo "The dashboard refreshes frames every second"

exit 0
