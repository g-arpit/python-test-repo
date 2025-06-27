console.log("Script.js is loaded");

// Configuration
const defaultXPosition = 320;
let streamWidth = 640; // Default video width
let refreshInterval = 1000; // Refresh frame every 1 second
let refreshTimerId;
let consecutiveErrors = 0;
const maxErrors = 5;
const debugElement = document.getElementById('debug');
let cameraIP = "";
let metricsData = null;
let metricsRefreshInterval;
let isCheckingStatus = false;

// Function to log debug information
function debugLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    debugElement.textContent += logEntry + '\n';
    
    // Trim log if it gets too long
    if (debugElement.textContent.length > 5000) {
        const lines = debugElement.textContent.split('\n');
        debugElement.textContent = lines.slice(Math.max(lines.length - 50, 0)).join('\n');
    }
    
    console.log(message);
}

function toggleDebug() {
    debugElement.style.display = debugElement.style.display === 'none' ? 'block' : 'none';
}

// Initialize with current position
let currentXPosition = defaultXPosition;

// Elements
const verticalLine = document.getElementById('verticalLine');
const streamContainer = document.getElementById('streamContainer');
const xPositionInput = document.getElementById('xPosition');
const xPositionSlider = document.getElementById('xPositionSlider');
const statusMessage = document.getElementById('statusMessage');
const cameraFrame = document.getElementById('cameraFrame');
const frameTimestamp = document.getElementById('frameTimestamp');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const refreshRateInput = document.getElementById('refreshRate');
// const rtspLinkUrl = document.getElementById('rtspLinkUrl');
const metricsGrid = document.getElementById('metricsGrid');

// Tab switching functionality
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
        // Remove active class from all tabs and tab contents
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab
        this.classList.add('active');
        
        // Show corresponding tab content
        const tabName = this.getAttribute('data-tab');
        document.getElementById(tabName + 'Tab').classList.add('active');
        
        // If switching to metrics tab, refresh metrics
        if (tabName === 'metrics') {
            refreshMetrics();
        }
    });
});

// Initialize line position
function initializeInterface() {
    debugLog('Initializing interface');
    // extractCameraIP();
    // updateRtspLink();
    updateLinePosition(currentXPosition);
    
    // Set up the line dragging functionality
    setupLineDragging();
    
    // Initial metrics fetch
    refreshMetrics();
    
    // Set up metrics auto-refresh (every 60 seconds)
    metricsRefreshInterval = setInterval(refreshMetrics, 60000);
}

// Function to fetch and update metrics
function refreshMetrics() {
    debugLog('Refreshing system metrics');
    
    fetch('/metrics/status.json?t=' + new Date().getTime())
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch metrics: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            metricsData = data;
            renderMetrics(data);
            debugLog('Metrics refreshed successfully');
        })
        .catch(error => {
            debugLog('Error fetching metrics: ' + error);
            metricsGrid.innerHTML = `
                <div class="metric-card">
                    <div class="metric-header">Error Loading Metrics</div>
                    <div class="metric-details">${error.message}</div>
                    <div class="metric-details">Make sure the status.json file is accessible.</div>
                </div>
            `;
        });
}

// Render metrics data to the dashboard
function renderMetrics(data) {
    if (!data) return;
    
    // Format timestamp for display
    const timestamp = new Date(data.timestamp).toLocaleString();
    
    // Start building metrics HTML
    let metricsHTML = '';
    
    // CPU Usage Card
    const cpuUsageClass = data.cpu_usage.percent_used > 90 ? 'critical' : 
                        data.cpu_usage.percent_used > 70 ? 'warning' : 'normal';
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">CPU Usage</div>
            <div class="metric-value ${cpuUsageClass}">${data.cpu_usage.percent_used}%</div>
            <div class="progress-bar">
                <div class="progress-fill ${cpuUsageClass}" style="width: ${data.cpu_usage.percent_used}%"></div>
            </div>
        </div>
    `;
    
    // RAM Usage Card
    const ramUsagePercent = data.ram_usage.percent_used;
    const ramUsageClass = ramUsagePercent > 90 ? 'critical' : 
                       ramUsagePercent > 70 ? 'warning' : 'normal';
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">RAM Usage</div>
            <div class="metric-value ${ramUsageClass}">${ramUsagePercent}%</div>
            <div class="metric-details">
                Used: ${data.ram_usage.used_mb.toFixed(2)} MB / Total: ${data.ram_usage.total_mb.toFixed(2)} MB
            </div>
            <div class="progress-bar">
                <div class="progress-fill ${ramUsageClass}" style="width: ${ramUsagePercent}%"></div>
            </div>
        </div>
    `;
    
    // Disk Usage Card
    const diskUsagePercent = data.disk_usage.percent_used;
    const diskUsageClass = diskUsagePercent > 90 ? 'critical' : 
                        diskUsagePercent > 70 ? 'warning' : 'normal';
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">Disk Usage</div>
            <div class="metric-value ${diskUsageClass}">${diskUsagePercent}%</div>
            <div class="metric-details">
                Used: ${data.disk_usage.used_gb.toFixed(2)} GB / Total: ${data.disk_usage.total_gb.toFixed(2)} GB
            </div>
            <div class="progress-bar">
                <div class="progress-fill ${diskUsageClass}" style="width: ${diskUsagePercent}%"></div>
            </div>
        </div>
    `;
    
    // System Temperature
    const tempClass = data.system_temperature.temperature_c > 80 ? 'critical' : 
                   data.system_temperature.temperature_c > 70 ? 'warning' : 'normal';
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">System Temperature</div>
            <div class="metric-value ${tempClass}">${data.system_temperature.temperature_c}°C</div>
            <div class="metric-details">${data.system_temperature.temperature_f}°F</div>
        </div>
    `;
    
    // Services Status
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">Services Status</div>
            <div class="metric-details">
                <div><span class="status-dot status-${data.apc_status.status}"></span> APC: ${data.apc_status.status}</div>
                <div><span class="status-dot status-${data.rtsp_recorder_status.status}"></span> RTSP Recorder: ${data.rtsp_recorder_status.status}</div>
                <div><span class="status-dot status-${data.internet_connectivity.status === 'connected' ? 'connected' : 'disconnected'}"></span> Internet: ${data.internet_connectivity.status}</div>
            </div>
        </div>
    `;
    
    // Network Status
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">Network Status</div>
            <div class="metric-details">
                <div><strong>Interface:</strong> eth0</div>
                <div><strong>Status:</strong> <span class="status-dot status-${data.eth0_status.status}"></span>${data.eth0_status.status}</div>
                <div><strong>IP Address:</strong> ${data.eth0_status.ip_address}</div>
            </div>
        </div>
    `;
    
    // Pending Videos
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">Pending Videos</div>
            <div class="metric-value">${data.pending_videos.count}</div>
            <div class="metric-details">
                <div><strong>First File:</strong> ${data.pending_videos.first_file}</div>
                <div><strong>First Timestamp:</strong> ${new Date(data.pending_videos.first_file_timestamp).toLocaleString()}</div>
                <div><strong>Latest File:</strong> ${data.pending_videos.latest_file}</div>
                <div><strong>Latest Timestamp:</strong> ${new Date(data.pending_videos.latest_file_timestamp).toLocaleString()}</div>
            </div>
        </div>
    `;
    
    // Last Updated Timestamp
    metricsHTML += `
        <div class="metric-card">
            <div class="metric-header">System Information</div>
            <div class="metric-details">
                <div><strong>Root Mount:</strong> ${data.root_mount.mode}</div>
                <div><strong>Root Mount Details:</strong> ${data.root_mount.details}</div>
            </div>
            <div class="metric-timestamp">Last Updated: ${timestamp}</div>
        </div>
    `;
    
    // Update the metrics grid
    metricsGrid.innerHTML = metricsHTML;
}

// Set up event listeners for line dragging
function setupLineDragging() {
    let isDragging = false;
    
    verticalLine.addEventListener('mousedown', function(e) {
        isDragging = true;
        debugLog('Started dragging line');
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            const rect = streamContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            
            // Calculate position as percentage of container width
            const containerWidth = streamContainer.offsetWidth;
            const percentage = Math.max(0, Math.min(x / containerWidth, 1));
            
            // Convert to actual image coordinate
            const imagePosition = Math.round(percentage * streamWidth);
            
            updateLinePosition(imagePosition);
        }
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            debugLog('Stopped dragging line at position: ' + currentXPosition);
        }
    });
    
    // Touch support for mobile devices
    verticalLine.addEventListener('touchstart', function(e) {
        isDragging = true;
        debugLog('Started touch dragging');
        e.preventDefault();
    });
    
    document.addEventListener('touchmove', function(e) {
        if (isDragging && e.touches.length > 0) {
            const touch = e.touches[0];
            const rect = streamContainer.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            
            const containerWidth = streamContainer.offsetWidth;
            const percentage = Math.max(0, Math.min(x / containerWidth, 1));
            const imagePosition = Math.round(percentage * streamWidth);
            
            updateLinePosition(imagePosition);
        }
    });
    
    document.addEventListener('touchend', function() {
        if (isDragging) {
            isDragging = false;
            debugLog('Stopped touch dragging at position: ' + currentXPosition);
        }
    });
}

// Load coordinates on page load
window.addEventListener('load', function() {
    debugLog('Page loaded');
    
    cameraFrame.addEventListener('load', handleImageLoaded);
    cameraFrame.addEventListener('error', handleImageError);

    initializeInterface();
    loadCoordinates();
    startFrameRefresh();
    refreshDirectory();
});

// Clean up on unload
window.addEventListener('beforeunload', function() {
    stopFrameRefresh();
    if (metricsRefreshInterval) {
        clearInterval(metricsRefreshInterval);
    }
});

// Start the refresh timer
function startFrameRefresh() {
    stopFrameRefresh(); // Clear any existing timer
    refreshFrame(); // Refresh immediately
    refreshTimerId = setInterval(refreshFrame, refreshInterval);
    debugLog('Started frame refresh interval: ' + refreshInterval + 'ms');
}

// Stop the refresh timer
function stopFrameRefresh() {
    if (refreshTimerId) {
        clearInterval(refreshTimerId);
        debugLog('Stopped frame refresh');
    }
}

// Update refresh rate
function updateRefreshRate(seconds) {
    refreshInterval = parseInt(seconds) * 1000;
    debugLog('Updated refresh rate to: ' + refreshInterval + 'ms');
    startFrameRefresh();
}

// Handle successful image load
function handleImageLoaded() {
    console.log("Handle image loaded fired")
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'none';
    consecutiveErrors = 0;
    
    // Update frame timestamp
    frameTimestamp.textContent = new Date().toLocaleTimeString();
    
    // Once the image has loaded, update the slider max and streamWidth if needed
    if (cameraFrame.naturalWidth > 0 && streamWidth !== cameraFrame.naturalWidth) {
        streamWidth = cameraFrame.naturalWidth;
        xPositionSlider.max = streamWidth;
        debugLog('Updated stream width to: ' + streamWidth);
        updateLinePosition(currentXPosition);
    }
}

// Handle image load error
function handleImageError() {
    loadingIndicator.style.display = 'none';
    consecutiveErrors++;
    
    debugLog(`Frame load error #${consecutiveErrors}`);
    
    if (consecutiveErrors >= maxErrors) {
        errorMessage.style.display = 'block';
        debugLog('Too many consecutive errors, showing error message');
    }
}

// Function to refresh the frame with a timestamp to prevent caching
function refreshFrame() {
    const timestamp = new Date().getTime();
    console.log("Refreshing frame at", timestamp);
    loadingIndicator.style.display = 'block';
    cameraFrame.src = '/frames/current.jpg?t=' + timestamp;
}

// Function to update the line position
function updateLinePosition(position) {
    // Parse and constrain to valid range
    const parsedPosition = parseInt(position);
    if (isNaN(parsedPosition)) return;
    
    currentXPosition = Math.max(0, Math.min(parsedPosition, streamWidth));
    
    // Calculate position as percentage of the stream width
    const percentage = currentXPosition / streamWidth;
    
    // Update UI elements
    verticalLine.style.left = (percentage * 100) + '%';
    xPositionInput.value = currentXPosition;
    xPositionSlider.value = currentXPosition;
}

// Function to save coordinates to the server
function saveCoordinates() {
    debugLog('Saving coordinates: x=' + currentXPosition);
    
    // Show status as pending
    statusMessage.textContent = 'Saving...';
    statusMessage.className = 'status';
    statusMessage.style.display = 'block';
    
    // Use fetch to save coordinates
    fetch('/cgi-bin/save-coords.sh', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'x_position=' + currentXPosition
    })
    .then(response => {
        debugLog('Save response status: ' + response.status);
        return response.text();
    })
    .then(data => {
        debugLog('Save response: ' + data);
        
        // Show status message
        statusMessage.textContent = 'Configuration saved successfully.';
        statusMessage.className = 'status success';
        
        // Hide after 3 seconds
        setTimeout(function() {
            statusMessage.style.display = 'none';
        }, 3000);
        
        // Add to history
        addHistoryEntry(currentXPosition);
    })
    .catch(error => {
        debugLog('Save error: ' + error);
        statusMessage.textContent = 'Error saving configuration: ' + error;
        statusMessage.className = 'status error';
    });
}

// Function to load coordinates from the server
function loadCoordinates() {
    debugLog('Loading coordinates from server');
    
    fetch('/cgi-bin/get-coords.sh')
    .then(response => {
        debugLog('Load response status: ' + response.status);
        return response.text();
    })
    .then(text => {
        debugLog('Raw response: ' + text);
        try {
            const data = JSON.parse(text);
            debugLog('Parsed data: ' + JSON.stringify(data));
            
            if (data && typeof data.x_position !== 'undefined') {
                debugLog('Loaded x_position: ' + data.x_position);
                updateLinePosition(data.x_position);
            } else {
                debugLog('No valid x_position in response');
            }
        } catch (e) {
            debugLog('Error parsing response: ' + e);
        }
    })
    .catch(error => {
        debugLog('Error loading coordinates: ' + error);
        console.error('Error loading coordinates:', error);
    });
}

// Function to add entry to history
function addHistoryEntry(position) {
    const now = new Date();
    const timestamp = now.toLocaleString();
    
    const historyEntry = document.createElement('div');
    historyEntry.className = 'history-entry';
    historyEntry.textContent = `Position: ${position}px (${timestamp})`;
    
    const historyEntries = document.getElementById('historyEntries');
    historyEntries.insertBefore(historyEntry, historyEntries.firstChild.nextSibling);
    
    debugLog('Added history entry: ' + position + 'px');
}

// Historical data functionality
let historicalData = [];
let charts = {};
let loadedFiles = [];
let systemEvents = [];

// Event detection thresholds (configurable)
const THRESHOLDS = {
    TEMP_HIGH: 80,      // °C
    TEMP_CRITICAL: 85,  // °C
    RAM_HIGH: 80,       // %
    RAM_CRITICAL: 95,   // %
    DISK_HIGH: 85,      // %
    DISK_CRITICAL: 95   // %
};

// Expected data collection interval in minutes
const EXPECTED_INTERVAL_MINUTES = 1;

async function loadAllHistoricalData() {
    const folderPath = document.getElementById('csvFolder').value.trim() || './metrics/';
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    showLoading(true);
    showMessage('', '');
    historicalData = [];
    loadedFiles = [];
    systemEvents = [];

    try {
        // Generate potential file names based on date range or last 30 days
        const filesToTry = generateFileNames(startDate, endDate);
        
        let loadedCount = 0;
        let totalAttempts = filesToTry.length;

        for (const fileName of filesToTry) {
            try {
                const filePath = folderPath + fileName;
                const csvData = await loadCSVFile(filePath);
                
                if (csvData && csvData.length > 0) {
                    historicalData = historicalData.concat(csvData);
                    loadedFiles.push(fileName);
                    loadedCount++;
                }
            } catch (error) {
                // File doesn't exist or can't be read, continue with next file
                console.log(`Could not load ${fileName}: ${error.message}`);
            }
        }

        if (historicalData.length === 0) {
            throw new Error(`No CSV files found in ${folderPath}. Tried ${totalAttempts} files.`);
        }

        // Sort by timestamp
        historicalData.sort((a, b) => a.timestamp - b.timestamp);

        // Apply date filtering if specified
        if (startDate) {
            const start = new Date(startDate + 'T00:00:00');
            historicalData = historicalData.filter(row => row.timestamp >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate + 'T23:59:59');
            historicalData = historicalData.filter(row => row.timestamp <= end);
        }

        if (historicalData.length === 0) {
            throw new Error('No data found for the selected date range');
        }

        // Analyze events
        analyzeSystemEvents();

        displayHistoricalData();
        showMessage(`Successfully loaded ${historicalData.length} records from ${loadedCount} files: ${loadedFiles.join(', ')}`, 'success');
        
    } catch (error) {
        showMessage('Error loading data: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function loadTodayData() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('startDate').value = today;
    document.getElementById('endDate').value = today;
    await loadAllHistoricalData();
}

function generateFileNames(startDate, endDate) {
    const files = [];
    const today = new Date();
    
    let start, end;
    
    if (startDate && endDate) {
        start = new Date(startDate);
        end = new Date(endDate);
    } else if (startDate) {
        start = new Date(startDate);
        end = new Date(today);
    } else if (endDate) {
        start = new Date(endDate);
        start.setDate(start.getDate() - 30); // Go back 30 days from end date
        end = new Date(endDate);
    } else {
        // Default: last 30 days
        start = new Date(today);
        start.setDate(today.getDate() - 30);
        end = new Date(today);
    }

    // Generate file names for each day in the range
    const currentDate = new Date(start);
    while (currentDate <= end) {
        const dateString = currentDate.toISOString().split('T')[0];
        files.push(`report_${dateString}.csv`);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return files;
}

async function loadCSVFile(filePath) {
    try {
        // Try to read the file using different methods
        let csvText;
        
        // Method 1: Try fetch (works if files are served by web server)
        try {
            const response = await fetch(filePath);
            if (response.ok) {
                csvText = await response.text();
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (fetchError) {
            // Method 2: Try file system API if available (modern browsers with file system access)
            if (window.fs && window.fs.readFile) {
                try {
                    csvText = await window.fs.readFile(filePath, { encoding: 'utf8' });
                } catch (fsError) {
                    throw new Error(`Cannot read file: ${fsError.message}`);
                }
            } else {
                throw new Error(`File not accessible: ${fetchError.message}`);
            }
        }

        if (!csvText || csvText.trim().length === 0) {
            throw new Error('File is empty');
        }

        const parsed = Papa.parse(csvText, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            delimitersToGuess: [',', ';', '\t']
        });

        if (parsed.errors.length > 0) {
            console.warn(`Parsing warnings for ${filePath}:`, parsed.errors);
        }

        return parsed.data.map(row => ({
            ...row,
            timestamp: new Date(row.timestamp),
            disk_percent: parseFloat(row.disk_percent) || 0,
            ram_percent: parseFloat(row.ram_percent) || 0,
            temperature_c: parseFloat(row.temperature_c) || 0,
            cpu_percent: parseFloat(row.cpu_percent) || 0,
            arp_device_count: parseInt(row.arp_device_count) || 0,
            apc_status: row.apc_status || 'unknown',
            rtsp_status: row.rtsp_recorder_status || 'unknown',
            internet_status: row.internet_status || 'unknown'
        })).filter(row => row.timestamp && !isNaN(row.timestamp.getTime()));

    } catch (error) {
        throw new Error(`Failed to load ${filePath}: ${error.message}`);
    }
}

function calculateUptimeStats() {
    if (historicalData.length === 0) return {};

    const firstTimestamp = historicalData[0].timestamp;
    const lastTimestamp = historicalData[historicalData.length - 1].timestamp;
    const totalTimeRange = lastTimestamp - firstTimestamp; // in milliseconds
    const totalHours = totalTimeRange / (1000 * 60 * 60);

    // console.log(`last: ${lastTimestamp}, first: ${firstTimestamp}`);

    // Generate expected timestamps based on interval
    const expectedTimestamps = [];
    const intervalMs = EXPECTED_INTERVAL_MINUTES * 60 * 1000;
    
    for (let time = firstTimestamp.getTime(); time <= lastTimestamp.getTime(); time += intervalMs) {
        expectedTimestamps.push(new Date(time));
    }

    // Create maps for quick lookup
    const dataMap = new Map();
    historicalData.forEach(row => {
        const timeKey = Math.floor(row.timestamp.getTime() / intervalMs) * intervalMs;
        dataMap.set(timeKey, row);
    });

    let systemUpTime = 0;
    let apcUpTime = 0;
    let rtspUpTime = 0;
    let internetUpTime = 0;

    expectedTimestamps.forEach(expectedTime => {
        const timeKey = Math.floor(expectedTime.getTime() / intervalMs) * intervalMs;
        const dataPoint = dataMap.get(timeKey);
        
        if (dataPoint) {
            // System is up if data exists
            systemUpTime += EXPECTED_INTERVAL_MINUTES;
            
            // Check service statuses
            if (dataPoint.apc_status === 'running') apcUpTime += EXPECTED_INTERVAL_MINUTES;
            if (dataPoint.rtsp_status === 'running') rtspUpTime += EXPECTED_INTERVAL_MINUTES;
            if (dataPoint.internet_status === 'connected') internetUpTime += EXPECTED_INTERVAL_MINUTES;
        }
        // If no data point exists, system is considered down
    });

    const totalMinutes = Math.ceil(totalHours * 60);

    // console.log(`systemUpTime: ${systemUpTime}`);
    // console.log(`apcUpTime: ${apcUpTime}`);
    // console.log(`rtspUpTime: ${rtspUpTime}`);
    // console.log(`internetUpTime: ${internetUpTime}`);
    // console.log(`totalMinutes: ${totalMinutes}`);

    return {
        systemUptime: totalMinutes > 0 ? (systemUpTime / totalMinutes * 100) : 0,
        apcUptime: totalMinutes > 0 ? (apcUpTime / totalMinutes * 100) : 0,
        rtspUptime: totalMinutes > 0 ? (rtspUpTime / totalMinutes * 100) : 0,
        internetUptime: totalMinutes > 0 ? (internetUpTime / totalMinutes * 100) : 0,
        totalHours: totalHours
    };
}

function analyzeSystemEvents() {
    systemEvents = [];
    let previousRow = null;

    for (let i = 0; i < historicalData.length; i++) {
        const row = historicalData[i];
        const prev = previousRow;

        // System offline/online events (APC status changes)
        if (prev) {
            if (prev.apc_status === 'running' && row.apc_status !== 'running') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'critical',
                    icon: '⚡',
                    message: 'APC went offline',
                    value: `Status: ${row.apc_status}`
                });
            } else if (prev.apc_status !== 'running' && row.apc_status === 'running') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'recovery',
                    icon: '✓',
                    message: 'APC came back online',
                    value: 'Status: running'
                });
            }

            // RTSP status changes
            if (prev.rtsp_status === 'running' && row.rtsp_status !== 'running') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'warning',
                    icon: '📹',
                    message: 'RTSP service went down',
                    value: `Status: ${row.rtsp_status}`
                });
            } else if (prev.rtsp_status !== 'running' && row.rtsp_status === 'running') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'recovery',
                    icon: '✓',
                    message: 'RTSP service restored',
                    value: 'Status: running'
                });
            }

            // Internet status changes
            if (prev.internet_status === 'connnected' && row.internet_status !== 'connected') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'warning',
                    icon: '🌐',
                    message: 'Internet connectivity lost',
                    value: `Status: ${row.internet_status}`
                });
            } else if (prev.internet_status !== 'connected' && row.internet_status === 'connected') {
                systemEvents.push({
                    timestamp: row.timestamp,
                    type: 'recovery',
                    icon: '✓',
                    message: 'Internet connectivity restored',
                    value: 'Status: up'
                });
            }
        }

        // Temperature events
        if (prev && prev.temperature_c < THRESHOLDS.TEMP_CRITICAL && row.temperature_c >= THRESHOLDS.TEMP_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'critical',
                icon: '🔥',
                message: 'Temperature reached critical level',
                value: `${row.temperature_c}°C (>= ${THRESHOLDS.TEMP_CRITICAL}°C)`
            });
        } else if (prev && prev.temperature_c < THRESHOLDS.TEMP_HIGH && row.temperature_c >= THRESHOLDS.TEMP_HIGH && row.temperature_c < THRESHOLDS.TEMP_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'warning',
                icon: '⚠',
                message: 'Temperature is high',
                value: `${row.temperature_c}°C (>= ${THRESHOLDS.TEMP_HIGH}°C)`
            });
        } else if (prev && prev.temperature_c >= THRESHOLDS.TEMP_HIGH && row.temperature_c < THRESHOLDS.TEMP_HIGH) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'recovery',
                icon: '✓',
                message: 'Temperature returned to normal',
                value: `${row.temperature_c}°C (< ${THRESHOLDS.TEMP_HIGH}°C)`
            });
        }

        // RAM events
        if (prev && prev.ram_percent < THRESHOLDS.RAM_CRITICAL && row.ram_percent >= THRESHOLDS.RAM_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'critical',
                icon: '💾',
                message: 'RAM usage reached critical level',
                value: `${row.ram_percent}% (>= ${THRESHOLDS.RAM_CRITICAL}%)`
            });
        } else if (prev && prev.ram_percent < THRESHOLDS.RAM_HIGH && row.ram_percent >= THRESHOLDS.RAM_HIGH && row.ram_percent < THRESHOLDS.RAM_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'warning',
                icon: '⚠',
                message: 'RAM usage is high',
                value: `${row.ram_percent}% (>= ${THRESHOLDS.RAM_HIGH}%)`
            });
        } else if (prev && prev.ram_percent >= THRESHOLDS.RAM_HIGH && row.ram_percent < THRESHOLDS.RAM_HIGH) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'recovery',
                icon: '✓',
                message: 'RAM usage returned to normal',
                value: `${row.ram_percent}% (< ${THRESHOLDS.RAM_HIGH}%)`
            });
        }

        // Disk events
        if (prev && prev.disk_percent < THRESHOLDS.DISK_CRITICAL && row.disk_percent >= THRESHOLDS.DISK_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'critical',
                icon: '💽',
                message: 'Disk usage reached critical level',
                value: `${row.disk_percent}% (>= ${THRESHOLDS.DISK_CRITICAL}%)`
            });
        } else if (prev && prev.disk_percent < THRESHOLDS.DISK_HIGH && row.disk_percent >= THRESHOLDS.DISK_HIGH && row.disk_percent < THRESHOLDS.DISK_CRITICAL) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'warning',
                icon: '⚠',
                message: 'Disk usage is high',
                value: `${row.disk_percent}% (>= ${THRESHOLDS.DISK_HIGH}%)`
            });
        } else if (prev && prev.disk_percent >= THRESHOLDS.DISK_HIGH && row.disk_percent < THRESHOLDS.DISK_HIGH) {
            systemEvents.push({
                timestamp: row.timestamp,
                type: 'recovery',
                icon: '✓',
                message: 'Disk usage returned to normal',
                value: `${row.disk_percent}% (< ${THRESHOLDS.DISK_HIGH}%)`
            });
        }

        previousRow = row;
    }

    // Sort events by timestamp (most recent first)
    systemEvents.sort((a, b) => b.timestamp - a.timestamp);
}

function displayHistoricalData() {
    const container = document.getElementById('historicalDataContainer');
    container.style.display = 'block';

    // Display summary
    displayDataSummary();
    
    // Display events
    displaySystemEvents();
    
    // Create charts
    createCharts();
}

function displayDataSummary() {
    const summaryGrid = document.getElementById('summaryGrid');
    const loadedFilesInfo = document.getElementById('loadedFilesInfo');
    
    const totalRecords = historicalData.length;
    const avgTemp = (historicalData.reduce((sum, row) => sum + row.temperature_c, 0) / totalRecords).toFixed(1);
    const avgRam = (historicalData.reduce((sum, row) => sum + row.ram_percent, 0) / totalRecords).toFixed(1);
    const avgDisk = (historicalData.reduce((sum, row) => sum + row.disk_percent, 0) / totalRecords).toFixed(1);
    const avgCpu = (historicalData.reduce((sum, row) => sum + row.cpu_percent, 0) / totalRecords).toFixed(1);
    const maxTemp = Math.max(...historicalData.map(row => row.temperature_c)).toFixed(1);
    const minTemp = Math.min(...historicalData.map(row => row.temperature_c)).toFixed(1);
    
    // Calculate uptime statistics
    const uptimeStats = calculateUptimeStats();

    // Display loaded files info
    loadedFilesInfo.textContent = `Loaded files: ${loadedFiles.join(', ')} | Time range: ${uptimeStats.totalHours.toFixed(1)} hours`;

    summaryGrid.innerHTML = `
        <div class="summary-item">
            <div class="summary-value">${totalRecords}</div>
            <div class="summary-label">Total Records</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${avgTemp}°C</div>
            <div class="summary-label">Avg Temperature</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${maxTemp}°C</div>
            <div class="summary-label">Max Temperature</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${minTemp}°C</div>
            <div class="summary-label">Min Temperature</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${avgRam}%</div>
            <div class="summary-label">Avg RAM Usage</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${avgDisk}%</div>
            <div class="summary-label">Avg Disk Usage</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${avgCpu}%</div>
            <div class="summary-label">Avg Cpu Usage</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${uptimeStats.systemUptime.toFixed(1)}%</div>
            <div class="summary-label">System Uptime</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${uptimeStats.apcUptime.toFixed(1)}%</div>
            <div class="summary-label">APC Uptime</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${uptimeStats.rtspUptime.toFixed(1)}%</div>
            <div class="summary-label">RTSP Uptime</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${uptimeStats.internetUptime.toFixed(1)}%</div>
            <div class="summary-label">Internet Uptime</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${systemEvents.length}</div>
            <div class="summary-label">Total Events</div>
        </div>
    `;
}

function displaySystemEvents() {
    const eventsContainer = document.getElementById('eventsContainer');
    const eventsStats = document.getElementById('eventsStats');

    if (systemEvents.length === 0) {
        eventsContainer.innerHTML = '<div class="no-events">No important events detected</div>';
        eventsStats.style.display = 'none';
        return;
    }

    // Count events by type
    const eventCounts = {
        critical: 0,
        warning: 0,
        info: 0,
        recovery: 0
    };

    systemEvents.forEach(event => eventCounts[event.type]++);

    // Display events
    eventsContainer.innerHTML = systemEvents.map(event => `
        <div class="event-item">
            <div class="event-icon ${event.type}">${event.icon}</div>
            <div class="event-content">
                <div class="event-message">${event.message}</div>
                <div class="event-time">${event.timestamp.toLocaleString()}</div>
                <div class="event-value">${event.value}</div>
            </div>
        </div>
    `).join('');

    // Update stats
    document.getElementById('criticalCount').textContent = eventCounts.critical;
    document.getElementById('warningCount').textContent = eventCounts.warning;
    document.getElementById('infoCount').textContent = eventCounts.info;
    document.getElementById('recoveryCount').textContent = eventCounts.recovery;
    
    eventsStats.style.display = 'flex';
}

function createCharts() {
    const chartsContainer = document.getElementById('chartsContainer');
    chartsContainer.innerHTML = '';

    // Destroy existing charts
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};

    const timestamps = historicalData.map(row => row.timestamp);
    
    // Temperature Chart
    createChart('temperature', 'Temperature Over Time', timestamps, 
        historicalData.map(row => row.temperature_c), '°C', '#ff6384');
    
    // RAM Usage Chart
    createChart('ram', 'RAM Usage Over Time', timestamps, 
        historicalData.map(row => row.ram_percent), '%', '#36a2eb');
    
    // Disk Usage Chart
    createChart('disk', 'Disk Usage Over Time', timestamps, 
        historicalData.map(row => row.disk_percent), '%', '#4bc0c0');

    // Cpu Usage Chart
    createChart('cpu', 'Cpu Usage Over Time', timestamps,
        historicalData.map(row => row.cpu_percent), '%', '#4bc0c0');

    // Service Status Charts
    createServiceStatusChart('apc', 'APC Status Over Time', '#ff9f40');
    createServiceStatusChart('rtsp', 'RTSP Status Over Time', '#9966ff'); 
    createServiceStatusChart('internet', 'Internet Status Over Time', '#ffcd56');
    createSystemUptimeChart();
}

function createServiceStatusChart(service, title, color) {
    const chartsContainer = document.getElementById('chartsContainer');
    
    const chartCard = document.createElement('div');
    chartCard.className = 'chart-card';
    chartCard.innerHTML = `
        <div class="chart-title">${title}</div>
        <div class="chart-container">
            <canvas id="chart_${service}"></canvas>
        </div>
    `;
    
    chartsContainer.appendChild(chartCard);
    
    const ctx = document.getElementById(`chart_${service}`).getContext('2d');
    
    // Convert status to numeric values for charting
    const statusData = historicalData.map(row => {
        const status = row[`${service}_status`];
        if (service === 'internet') {
            return status === 'connected' ? 1 : 0;
        } else {
            return status === 'running' ? 1 : 0;
        }
    });

    const labels = historicalData.map(row => row.timestamp);
    
    charts[service] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${service.toUpperCase()} Status`,
                data: statusData,
                borderColor: color,
                backgroundColor: color + '20',
                tension: 0,
                fill: true,
                stepped: 'before'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'HH:mm'
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 1,
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return value === 1 ? 'Up' : 'Down';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const status = context.parsed.y === 1 ? 'Up/Running' : 'Down/Stopped';
                            return `${service.toUpperCase()}: ${status}`;
                        }
                    }
                }
            }
        }
    });
}

function createSystemUptimeChart() {
    const chartsContainer = document.getElementById('chartsContainer');
    
    const chartCard = document.createElement('div');
    chartCard.className = 'chart-card';
    chartCard.innerHTML = `
        <div class="chart-title">System Uptime Over Time</div>
        <div class="chart-container">
            <canvas id="chart_system_uptime"></canvas>
        </div>
    `;
    
    chartsContainer.appendChild(chartCard);
    
    const ctx = document.getElementById('chart_system_uptime').getContext('2d');
    
    // Create system uptime data based on data availability
    // Generate expected timeline
    const firstTimestamp = historicalData[0].timestamp;
    const lastTimestamp = historicalData[historicalData.length - 1].timestamp;
    const intervalMs = EXPECTED_INTERVAL_MINUTES * 60 * 1000;
    
    const expectedTimestamps = [];
    const systemUptimeData = [];
    
    // Create data map for quick lookup
    const dataMap = new Map();
    historicalData.forEach(row => {
        const timeKey = Math.floor(row.timestamp.getTime() / intervalMs) * intervalMs;
        dataMap.set(timeKey, row);
    });
    
    for (let time = firstTimestamp.getTime(); time <= lastTimestamp.getTime(); time += intervalMs) {
        const expectedTime = new Date(time);
        const timeKey = Math.floor(time / intervalMs) * intervalMs;
        const hasData = dataMap.has(timeKey);
        
        expectedTimestamps.push(expectedTime);
        systemUptimeData.push(hasData ? 1 : 0);
    }
    
    charts['system_uptime'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: expectedTimestamps,
            datasets: [{
                label: 'System Status',
                data: systemUptimeData,
                borderColor: '#28a745',
                backgroundColor: '#28a74520',
                tension: 0,
                fill: true,
                stepped: 'before'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'HH:mm'
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 1,
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return value === 1 ? 'Up' : 'Down';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const status = context.parsed.y === 1 ? 'Up (Data Available)' : 'Down (No Data)';
                            return `System: ${status}`;
                        }
                    }
                }
            }
        }
    });
}

function createChart(id, title, labels, data, unit, color, customOptions = {}) {
    const chartsContainer = document.getElementById('chartsContainer');
    
    const chartCard = document.createElement('div');
    chartCard.className = 'chart-card';
    chartCard.innerHTML = `
        <div class="chart-title">${title}</div>
        <div class="chart-container">
            <canvas id="chart_${id}"></canvas>
        </div>
    `;
    
    chartsContainer.appendChild(chartCard);
    
    const ctx = document.getElementById(`chart_${id}`).getContext('2d');
    
    const defaultOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                type: 'time',
                time: {
                    displayFormats: {
                        minute: 'HH:mm',
                        hour: 'HH:mm'
                    }
                }
            },
            y: {
                beginAtZero: true
            }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    label: function(context) {
                        return `${context.parsed.y}${unit}`;
                    }
                }
            }
        }
    };

    const options = { ...defaultOptions, ...customOptions };

    charts[id] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: data,
                borderColor: color,
                backgroundColor: color + '20',
                tension: 0.1,
                fill: true
            }]
        },
        options: options
    });
}

function showMessage(message, type) {
    const errorDiv = document.getElementById('historicalError');
    const successDiv = document.getElementById('historicalSuccess');
    
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    if (message) {
        if (type === 'error') {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        } else if (type === 'success') {
            successDiv.textContent = message;
            successDiv.style.display = 'block';
        }
    }
}

function showLoading(show) {
    const loading = document.getElementById('historicalLoading');
    const button = document.getElementById('loadDataBtn');
    
    loading.style.display = show ? 'block' : 'none';
    button.disabled = show;
    button.textContent = show ? 'Loading...' : 'Load Historical Data';
}

//Script for camera control

// Check service status with error handling and loading states
async function checkServiceStatus() {
    if (isCheckingStatus) return;
    isCheckingStatus = true;
    
    try {
        const response = await fetch('/cgi-bin/camera-control.sh?action=status', {
            method: 'GET',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        updateServiceStatusUI(data);
        
    } catch (error) {
        console.error('Error checking service status:', error);
        updateServiceStatusUI({ 
            status: 'error', 
            message: 'Failed to check service status' 
        });
    } finally {
        isCheckingStatus = false;
    }
}

// Update the UI based on service status
function updateServiceStatusUI(data) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const startBtn = document.getElementById('startCameraBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    
    if (!statusDot || !statusText || !startBtn || !stopBtn) return;
    
    switch (data.status) {
        case 'running':
            statusDot.className = 'status-dot running';
            statusText.textContent = 'Camera Service Running';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            startBtn.classList.remove('loading');
            stopBtn.classList.remove('loading');
            break;
            
        case 'stopped':
            statusDot.className = 'status-dot stopped';
            statusText.textContent = 'Camera Service Stopped';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            startBtn.classList.remove('loading');
            stopBtn.classList.remove('loading');
            break;
            
        default:
            statusDot.className = 'status-dot error';
            statusText.textContent = 'Error checking status';
            startBtn.disabled = false;
            stopBtn.disabled = false;
            startBtn.classList.remove('loading');
            stopBtn.classList.remove('loading');
            break;
    }
}

// Show service message with auto-hide
function showServiceMessage(message, type = 'info', autoHide = true) {
    const messageDiv = document.getElementById('serviceMessage');
    if (!messageDiv) return;
    
    messageDiv.textContent = message;
    messageDiv.className = `service-message ${type}`;
    messageDiv.style.display = 'block';
    
    if (autoHide) {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, type === 'error' ? 5000 : 3000);
    }
}

// Start camera service with improved error handling
async function startCameraService() {
    const startBtn = document.getElementById('startCameraBtn');
    if (!startBtn) return;
    
    startBtn.disabled = true;
    startBtn.classList.add('loading');
    showServiceMessage('Starting camera service...', 'info', false);
    
    try {
        const response = await fetch('/cgi-bin/camera-control.sh?action=start', {
            method: 'GET',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showServiceMessage(data.message || 'Camera service started successfully', 'success');
            // Refresh status after a short delay to allow service to fully start
            setTimeout(checkServiceStatus, 2000);
        } else {
            console.warn('Start service returned unexpected response:', data);
            showServiceMessage(data.message || 'Failed to start camera service', 'error');
            startBtn.disabled = false;
            startBtn.classList.remove('loading');
        }
        
    } catch (error) {
        console.error('Error starting service:', error);
        showServiceMessage('Network error: Could not start camera service', 'error');
        startBtn.disabled = false;
        startBtn.classList.remove('loading');
    }
}

// Stop camera service with improved error handling
async function stopCameraService() {
    const stopBtn = document.getElementById('stopCameraBtn');
    if (!stopBtn) return;
    
    stopBtn.disabled = true;
    stopBtn.classList.add('loading');
    showServiceMessage('Stopping camera service...', 'info', false);
    
    try {
        const response = await fetch('/cgi-bin/camera-control.sh?action=stop', {
            method: 'GET',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showServiceMessage(data.message || 'Camera service stopped successfully', 'success');
            // Refresh status after a short delay to allow service to fully stop
            setTimeout(checkServiceStatus, 2000);
        } else {
            showServiceMessage(data.message || 'Failed to stop camera service', 'error');
            stopBtn.disabled = false;
            stopBtn.classList.remove('loading');
        }
        
    } catch (error) {
        console.error('Error stopping service:', error);
        showServiceMessage('Network error: Could not stop camera service', 'error');
        stopBtn.disabled = false;
        stopBtn.classList.remove('loading');
    }
}

// Manual refresh of service status
function refreshServiceStatus() {
    const refreshBtn = document.getElementById('refreshStatusBtn');
    if (refreshBtn) {
        refreshBtn.textContent = '⟳';
        refreshBtn.disabled = true;
    }
    
    checkServiceStatus().finally(() => {
        if (refreshBtn) {
            refreshBtn.textContent = '↻';
            refreshBtn.disabled = false;
        }
    });
}

// Initialize service status checking when DOM is loaded
function initializeCameraControls() {
    // Check initial status
    checkServiceStatus();
    
    // Set up periodic status checking (every 10 seconds to avoid too frequent requests)
    serviceStatusInterval = setInterval(checkServiceStatus, 10000);
    
    // Add click handlers if not already set
    const refreshBtn = document.getElementById('refreshStatusBtn');
    if (refreshBtn && !refreshBtn.onclick) {
        refreshBtn.onclick = refreshServiceStatus;
    }
}

// Clean up interval when page is unloaded
function cleanupCameraControls() {
    if (serviceStatusInterval) {
        clearInterval(serviceStatusInterval);
        serviceStatusInterval = null;
    }
}

// Video Tab Functions for script.js

const BASE_DIR = ""; // Web alias to DIR_A
let currentPath = BASE_DIR;
let pathStack = []; // for back navigation

function refreshDirectory(path = currentPath, push = true) {
    if (push && currentPath !== path) pathStack.push(currentPath);
    currentPath = path;

    document.getElementById("explorerLoading").style.display = "block";
    document.getElementById("explorerError").style.display = "none";
    document.getElementById("fileExplorer").innerHTML = "";

    fetch(`/cgi-bin/video-explorer.sh?path=${encodeURIComponent(path.replace(BASE_DIR, ""))}`)
        .then(response => response.json())
        .then(data => {
            document.getElementById("explorerLoading").style.display = "none";
            renderExplorer(data, path);
        })
        .catch(err => {
            document.getElementById("explorerLoading").style.display = "none";
            document.getElementById("explorerError").innerText = "Failed to load directory.";
            document.getElementById("explorerError").style.display = "block";
        });
}

function renderExplorer(files, basePath) {
    const container = document.getElementById("fileExplorer");
    container.innerHTML = "";

    // Explorer header (Back + Refresh)
    const header = document.createElement("div");
    header.classList.add("explorer-header");

    const backBtn = document.createElement("button");
    backBtn.textContent = "⬅ Back";
    backBtn.classList.add("back-button");
    backBtn.disabled = pathStack.length === 0;
    backBtn.onclick = () => {
        if (pathStack.length > 0) {
            const previous = pathStack.pop();
            refreshDirectory(previous, false);
        }
    };

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.classList.add("refresh-btn");
    refreshBtn.onclick = () => refreshDirectory(currentPath, false);

    // Status: path + file count
    const statusBar = document.createElement("div");
    statusBar.classList.add("explorer-status");
    const relativePath = basePath.replace(BASE_DIR, "") || "/";
    const fileCountText = `${files.length} ${files.length === 1 ? "file" : "files"}`;
    statusBar.textContent = `📂 ${relativePath} — ${fileCountText}`;

    header.appendChild(backBtn);
    header.appendChild(refreshBtn);
    container.appendChild(header);
    container.appendChild(statusBar);

    const listContainer = document.createElement("div");
    listContainer.classList.add("scrollable-file-list");
    container.appendChild(listContainer);

    files.sort((a, b) => {
        // Sort descending by name (newest first, assuming epoch/file naming)
        return b.name.localeCompare(a.name);
    });

    if (files.length === 0) {
        const empty = document.createElement("div");
        empty.classList.add("empty-dir");
        empty.textContent = "📂 This folder is empty.";
        listContainer.appendChild(empty);
        return;
    }

    files.forEach(item => {
        const card = document.createElement("div");
        card.classList.add("file-card");

        const name = document.createElement("div");
        name.classList.add("file-name");
        name.textContent = item.name;

        const meta = document.createElement("div");
        meta.classList.add("file-meta");

        if (item.type === "directory") {
            card.classList.add("folder-card");
            meta.textContent = "📁 Folder";
            card.onclick = () => refreshDirectory(`${basePath}/${item.name}`);
        } else {
            card.classList.add("file-download-card");
            meta.textContent = `📄 .mp4 file • ${formatEpochToDate(item.name)}`;

            const relativePath = basePath.replace(BASE_DIR, "");
            const fullPath = `/videos${relativePath}/${item.name}`;
            card.onclick = () => {
                const link = document.createElement("a");
                link.href = fullPath;
                link.download = item.name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };
        }

        card.appendChild(name);
        card.appendChild(meta);
        listContainer.appendChild(card);
    });
}

function formatEpochToDate(filename) {
    const match = filename.match(/^(\d{13})\.mp4$/);
    if (!match) return "Unknown time";
    const epoch = parseInt(match[1]);
    const date = new Date(epoch);
    return date.toLocaleString();
}


