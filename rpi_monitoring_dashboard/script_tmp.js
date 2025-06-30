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

function extractStatusTransitions(service) {
    const intervalMs = EXPECTED_INTERVAL_MINUTES * 60 * 1000;
    const transitions = [];

    const dataMap = new Map();
    historicalData.forEach(row => {
        const timeKey = Math.floor(row.timestamp.getTime() / intervalMs) * intervalMs;
        dataMap.set(timeKey, row);
    });

    const sortedTimes = Array.from(dataMap.keys()).sort((a, b) => a - b);

    let lastStatus = null;
    let lastTime = null;

    for (const timeKey of sortedTimes) {
        const row = dataMap.get(timeKey);
        const currentStatus = (() => {
            const status = row[`${service}_status`];
            if (service === 'internet') return status === 'connected' ? 'Online' : 'Offline';
            return status === 'running' ? 'Online' : 'Offline';
        })();

        if (lastStatus === null) {
            lastStatus = currentStatus;
            lastTime = timeKey;
            continue;
        }

        if (currentStatus !== lastStatus) {
            transitions.push({
                status: lastStatus,
                start: new Date(lastTime),
                end: new Date(timeKey),
                durationMinutes: Math.round((timeKey - lastTime) / 60000)
            });

            lastStatus = currentStatus;
            lastTime = timeKey;
        }
    }

    // Final state
    if (lastStatus && lastTime !== null) {
        const lastTimestamp = sortedTimes[sortedTimes.length - 1];
        transitions.push({
            status: lastStatus,
            start: new Date(lastTime),
            end: new Date(lastTimestamp),
            durationMinutes: Math.round((lastTimestamp - lastTime) / 60000)
        });
    }

    return transitions;
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

    // Build section container
    const serviceSection = document.createElement('div');
    serviceSection.className = 'service-section';

    // Assign unique transition container ID
    const transitionId = `${service}Transitions`;

    serviceSection.innerHTML = `
        <div class="service-title">📡 ${service.toUpperCase()}</div>
        <div class="service-content">
            <div class="chart-card">
                <div class="chart-title">${title}</div>
                <div class="chart-container">
                    <canvas id="chart_${service}"></canvas>
                </div>
            </div>
            <div class="status-transitions" id="${transitionId}"></div>
        </div>
    `;

    // Append section *before* trying to render transitions
    chartsContainer.appendChild(serviceSection);

    const ctx = document.getElementById(`chart_${service}`).getContext('2d');

    // Reconstruct timeline
    const intervalMs = EXPECTED_INTERVAL_MINUTES * 60 * 1000;
    const firstTimestamp = historicalData[0].timestamp;
    const lastTimestamp = historicalData[historicalData.length - 1].timestamp;

    const dataMap = new Map();
    historicalData.forEach(row => {
        const timeKey = Math.floor(row.timestamp.getTime() / intervalMs) * intervalMs;
        dataMap.set(timeKey, row);
    });

    const labels = [];
    const statusData = [];

    for (let time = firstTimestamp.getTime(); time <= lastTimestamp.getTime(); time += intervalMs) {
        const timeKey = Math.floor(time / intervalMs) * intervalMs;
        const row = dataMap.get(timeKey);
        labels.push(new Date(timeKey));
        if (!row) {
            statusData.push(0);
        } else {
            const status = row[`${service}_status`];
            statusData.push(
                service === 'internet' ? (status === 'connected' ? 1 : 0) : (status === 'running' ? 1 : 0)
            );
        }
    }

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
                        callback: (value) => value === 1 ? 'Up' : 'Down'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const status = context.parsed.y === 1 ? 'Up/Running' : 'Down/Stopped';
                            return `${service.toUpperCase()}: ${status}`;
                        }
                    }
                }
            }
        }
    });

    // Generate transitions safely
    const transitions = extractStatusTransitions(service);
    const transitionContainer = document.getElementById(transitionId);
    transitionContainer.innerHTML = transitions.map(t => `
        <div class="transition-entry ${t.status.toLowerCase()}">
            <div class="status-label">${t.status}</div>
            <div class="time-range">${t.start.toLocaleString()} – ${t.end.toLocaleString()}</div>
            <div class="duration">${t.durationMinutes} minutes</div>
        </div>
    `).join('');
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

function renderTransitions(service, containerId) {
    const transitions = extractStatusTransitions(service);
    const container = document.getElementById(containerId);

    container.innerHTML = `
        <h4>Status Transitions</h4>
        ${transitions.map(t => `
            <div class="transition-entry ${t.status.toLowerCase()}">
                <div class="status-label">${t.status}</div>
                <div class="time-range">${t.start.toLocaleString()} – ${t.end.toLocaleString()}</div>
                <div class="duration">${t.durationMinutes} minutes</div>
            </div>
        `).join('')}
    `;
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