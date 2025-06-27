#!/usr/bin/env python3
"""
Raspberry Pi 5 Monitoring Service

This script monitors:
1. supervisorctl apc status
2. supervisorctl rtsp_recorder status
3. eth0 network interface status and IP
4. Root filesystem mount mode (ro/rw)
5. Connected devices via ARP
6. Disk usage
7. RAM usage
8. System temperature
9. Internet connectivity

It can be set up as a systemd service or run via cron.
"""

import os
import subprocess
import time
import logging
import json
from datetime import datetime
import socket
import sys

# Create log directory if it doesn't exist
os.makedirs('/var/log', exist_ok=True)

# Configure logging
try:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('/var/log/pi_monitor.log'),
            logging.StreamHandler()
        ]
    )
except Exception as e:
    # If we can't create the log file, just log to stderr
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler()
        ]
    )
    print(f"Warning: Could not create log file: {str(e)}", file=sys.stderr)

logger = logging.getLogger('pi_monitor')

# Try to import psutil, provide installation instructions if missing
try:
    import psutil
except ImportError:
    logger.error("psutil module not found. Please install it using: sudo pip3 install psutil")
    print("ERROR: psutil module not found. Please install it using: sudo pip3 install psutil", file=sys.stderr)
    # We'll continue without it and handle the missing module in each function

# File to store monitoring data
DATA_DIR = '/var/www/camera-dashboard/metrics'
DATA_FILE = os.path.join(DATA_DIR, 'status.json')

class RaspberryPiMonitor:
    def __init__(self):
        # Create data directory if it doesn't exist
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create data directory {DATA_DIR}: {str(e)}")
            # Try using a temp directory instead
            self.use_temp_dir()
    
    def use_temp_dir(self):
        """Use a temporary directory if the main data directory can't be created"""
        global DATA_FILE, DATA_DIR
        tmp_dir = '/tmp/pi_monitor'
        try:
            os.makedirs(tmp_dir, exist_ok=True)
            DATA_DIR = tmp_dir
            DATA_FILE = os.path.join(DATA_DIR, 'status.json')
            logger.warning(f"Using alternative data directory: {DATA_DIR}")
        except Exception as e:
            logger.error(f"Failed to create temp directory {tmp_dir}: {str(e)}")
            # Just use the current directory as last resort
            DATA_DIR = '.'
            DATA_FILE = os.path.join(DATA_DIR, 'status.json')
            logger.warning(f"Using current directory for data: {DATA_DIR}")
    
    def check_supervisor_service_status(self, service_name):
        """Generic function to check status of a supervisor service"""
        try:
            # Check if supervisorctl exists
            which_cmd = subprocess.run(['which', 'supervisorctl'], 
                                      capture_output=True, text=True, timeout=5)
            
            if which_cmd.returncode != 0:
                return {
                    'status': 'not_available',
                    'details': 'supervisorctl command not found'
                }
                
            # Run supervisorctl status for the service
            result = subprocess.run(['sudo', 'supervisorctl', 'status', service_name], 
                                   capture_output=True, text=True, timeout=10)
            
            # Process based on return code
            if result.returncode == 0:
                # Return code 0 means RUNNING
                return {
                    'status': 'running',
                    'details': result.stdout.strip()
                }
            elif result.returncode == 3:
                # Return code 3 means STOPPED
                return {
                    'status': 'stopped',
                    'details': result.stdout.strip()
                }
            else:
                # Some other return code
                return {
                    'status': 'unknown',
                    'details': f"Return code: {result.returncode}, Output: {result.stdout.strip()}, Error: {result.stderr.strip()}"
                }
        except subprocess.TimeoutExpired:
            return {
                'status': 'timeout',
                'details': 'Command timed out after 10 seconds'
            }
        except Exception as e:
            logger.error(f"Failed to check {service_name} status: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_apc_status(self):
        """Check supervisorctl apc status"""
        return self.check_supervisor_service_status('apc')
        
    def check_rtsp_recorder_status(self):
        """Check supervisorctl rtsp_recorder status"""
        return self.check_supervisor_service_status('rtsp_recorder')

    def check_eth0_status(self):
        """Check eth0 network interface status and IP address"""
        try:
            # Check if eth0 exists
            if_exists = subprocess.run(['ip', 'link', 'show', 'eth0'], 
                                      capture_output=True, text=True, timeout=5)
            
            if if_exists.returncode != 0:
                return {
                    'status': 'not_available',
                    'details': 'eth0 interface not found'
                }
            
            # Check if eth0 is up
            if_up = subprocess.run(['ip', 'link', 'show', 'eth0', 'up'], 
                                  capture_output=True, text=True, timeout=5)
            
            is_up = if_up.returncode == 0
            
            # Get IP address for eth0
            ip_addr = subprocess.run(['ip', 'addr', 'show', 'eth0'], 
                                    capture_output=True, text=True, timeout=5)
            
            ip_address = 'unknown'
            if ip_addr.returncode == 0:
                # Parse output to find IP address
                for line in ip_addr.stdout.splitlines():
                    if 'inet ' in line:
                        # Line looks like: inet 192.168.1.100/24 brd 192.168.1.255 scope global eth0
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            ip_address = parts[1].split('/')[0]
                            break
            
            return {
                'status': 'up' if is_up else 'down',
                'ip_address': ip_address,
                'details': ip_addr.stdout if ip_addr.returncode == 0 else 'Could not get IP details'
            }
        except Exception as e:
            logger.error(f"Failed to check eth0 status: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_root_mount_mode(self):
        """Check if / is mounted as read-only or read-write"""
        try:
            # Check mount options for root filesystem
            mount_cmd = subprocess.run(['mount'], 
                                      capture_output=True, text=True, timeout=5)
            
            if mount_cmd.returncode != 0:
                return {
                    'status': 'error',
                    'details': 'Failed to get mount information'
                }
            
            # Parse output to find root filesystem
            root_line = None
            for line in mount_cmd.stdout.splitlines():
                if ' / ' in line:
                    root_line = line
                    break
            
            if not root_line:
                return {
                    'status': 'error',
                    'details': 'Root filesystem not found in mount output'
                }
            
            # Check if ro or rw is in the options
            if '(ro' in root_line:
                mount_mode = 'ro'
            elif '(rw' in root_line:
                mount_mode = 'rw'
            else:
                # Try another approach
                touch_test = subprocess.run(['touch', '/test_write_permission'], 
                                           capture_output=True, text=True, timeout=5)
                if touch_test.returncode == 0:
                    # Clean up test file
                    subprocess.run(['rm', '/test_write_permission'], timeout=5)
                    mount_mode = 'rw'
                else:
                    mount_mode = 'ro'
            
            return {
                'mode': mount_mode,
                'details': root_line
            }
        except Exception as e:
            logger.error(f"Failed to check root mount mode: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_cpu_usage(self):
        """Check CPU usage percentage"""
        try:
            # Check if psutil is available
            if 'psutil' not in sys.modules:
                # Fall back to top command
                result = subprocess.run(['top', '-bn1'], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    # Parse top output to get CPU usage
                    for line in result.stdout.splitlines():
                        if line.startswith('%Cpu(s):'):
                            # Line looks like: %Cpu(s):  5.9 us,  2.4 sy,  0.0 ni, 91.2 id,  0.5 wa,  0.0 hi,  0.0 si,  0.0 st
                            parts = line.split(',')
                            for part in parts:
                                if 'id' in part:  # idle percentage
                                    idle_pct = float(part.split()[0])
                                    return {
                                        'percent_used': round(100.0 - idle_pct, 1)
                                    }
                return {
                    'status': 'error',
                    'details': 'Failed to parse CPU usage'
                }
            
            # Use psutil if available
            cpu_percent = psutil.cpu_percent(interval=1)
            return {
                'percent_used': cpu_percent
            }
        except Exception as e:
            logger.error(f"Failed to check CPU usage: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_pending_videos(self):
        """Check pending video files in input_videos directory"""
        try:
            # Path to monitor
            input_dir = '/home/chalopi/apc/input_videos'
            
            # Check if directory exists
            if not os.path.isdir(input_dir):
                return {
                    'status': 'error',
                    'details': f'Directory {input_dir} does not exist'
                }
            
            # Get all files in the directory
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            
            # Count files
            file_count = len(files)
            
            # If no files, return empty report
            if file_count == 0:
                return {
                    'count': 0,
                    'first_file': None,
                    'first_file_timestamp': None,
                    'latest_file': None,
                    'latest_file_timestamp': None
                }
            
            # Get file stats - try to extract epoch times from filenames
            file_stats = []
            for filename in files:
                full_path = os.path.join(input_dir, filename)
                stats = os.stat(full_path)
                
                # Try to extract timestamp from filename (assuming epoch ms format)
                try:
                    # Extract digits from filename
                    digits_only = ''.join(filter(str.isdigit, filename))
                    
                    # If we have at least 10 digits (seconds precision) or 13 digits (ms precision)
                    if len(digits_only) >= 10:
                        # Convert to timestamp (ms to s if needed)
                        if len(digits_only) >= 13:  # milliseconds format
                            epoch_time = int(digits_only[:13]) / 1000
                        else:  # seconds format
                            epoch_time = int(digits_only[:10])
                            
                        # Create datetime from epoch
                        file_date = datetime.fromtimestamp(epoch_time)
                        timestamp_str = file_date.isoformat()
                    else:
                        # Fall back to file modification time
                        epoch_time = stats.st_mtime
                        timestamp_str = datetime.fromtimestamp(stats.st_mtime).isoformat()
                except Exception:
                    # Fall back to file modification time if parsing fails
                    epoch_time = stats.st_mtime
                    timestamp_str = datetime.fromtimestamp(stats.st_mtime).isoformat()
                
                file_stats.append({
                    'name': filename,
                    'path': full_path,
                    'mtime': epoch_time,
                    'mtime_str': timestamp_str
                })
            
            # Sort by extracted or modification time
            file_stats.sort(key=lambda x: x['mtime'])
            
            # Get oldest and newest files
            oldest_file = file_stats[0]
            newest_file = file_stats[-1]
            
            return {
                'count': file_count,
                'first_file': oldest_file['name'],
                'first_file_timestamp': oldest_file['mtime_str'],
                'latest_file': newest_file['name'],
                'latest_file_timestamp': newest_file['mtime_str']
            }
        except Exception as e:
            logger.error(f"Failed to check pending videos: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_disk_usage(self):
        """Check disk usage for the root filesystem"""
        try:
            # Check if psutil is available
            if 'psutil' not in sys.modules:
                # Fall back to df command
                result = subprocess.run(['df', '-h', '/'], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    lines = result.stdout.strip().split('\n')
                    if len(lines) >= 2:
                        # Parse df output
                        parts = lines[1].split()
                        if len(parts) >= 5:
                            total = parts[1]
                            used = parts[2]
                            avail = parts[3]
                            percent = parts[4].rstrip('%')
                            return {
                                'total': total,
                                'used': used,
                                'available': avail,
                                'percent_used': float(percent)
                            }
                return {
                    'status': 'error',
                    'details': 'Failed to parse disk usage'
                }
            
            # Use psutil if available
            disk = psutil.disk_usage('/')
            return {
                'total_gb': round(disk.total / (1024**3), 2),
                'used_gb': round(disk.used / (1024**3), 2),
                'free_gb': round(disk.free / (1024**3), 2),
                'percent_used': disk.percent
            }
        except Exception as e:
            logger.error(f"Failed to check disk usage: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_ram_usage(self):
        """Check RAM usage"""
        try:
            # Check if psutil is available
            if 'psutil' not in sys.modules:
                # Fall back to free command
                result = subprocess.run(['free', '-m'], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    lines = result.stdout.strip().split('\n')
                    if len(lines) >= 2:
                        # Parse free output
                        parts = lines[1].split()
                        if len(parts) >= 3:
                            total = float(parts[1])
                            used = float(parts[2])
                            free = total - used
                            percent_used = (used / total) * 100 if total > 0 else 0
                            return {
                                'total_mb': total,
                                'used_mb': used,
                                'free_mb': free,
                                'percent_used': round(percent_used, 1)
                            }
                return {
                    'status': 'error',
                    'details': 'Failed to parse RAM usage'
                }
            
            # Use psutil if available
            ram = psutil.virtual_memory()
            return {
                'total_mb': round(ram.total / (1024**2), 2),
                'used_mb': round(ram.used / (1024**2), 2),
                'free_mb': round(ram.free / (1024**2), 2),
                'percent_used': ram.percent
            }
        except Exception as e:
            logger.error(f"Failed to check RAM usage: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_system_temperature(self):
        """Check system temperature"""
        try:
            # First try the standard Raspberry Pi 5 thermal zone
            temp_files = [
                '/sys/class/thermal/thermal_zone0/temp',  # RPi standard
                '/sys/devices/virtual/thermal/thermal_zone0/temp',  # Alternative path
                '/sys/class/hwmon/hwmon0/temp1_input'  # Generic Linux
            ]
            
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    with open(temp_file, 'r') as f:
                        temp_raw = f.read().strip()
                        # Handle different formats (some give millicelsius, some celsius)
                        if len(temp_raw) >= 5:  # Likely millicelsius (e.g. 43250)
                            temp_celsius = int(temp_raw) / 1000
                        else:  # Likely direct celsius (e.g. 43)
                            temp_celsius = float(temp_raw)
                        
                        return {
                            'temperature_c': round(temp_celsius, 1),
                            'temperature_f': round((temp_celsius * 9/5) + 32, 1)
                        }
            
            # If we reach here, we didn't find any temperature file
            # Try the vcgencmd tool as a fallback
            result = subprocess.run(['vcgencmd', 'measure_temp'], 
                                   capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                # Output is typically "temp=43.2'C"
                output = result.stdout.strip()
                if 'temp=' in output:
                    temp_str = output.split('=')[1].replace("'C", "")
                    temp_celsius = float(temp_str)
                    return {
                        'temperature_c': round(temp_celsius, 1),
                        'temperature_f': round((temp_celsius * 9/5) + 32, 1)
                    }
            
            return {
                'status': 'error',
                'details': 'Could not find temperature information'
            }
        except Exception as e:
            logger.error(f"Failed to check system temperature: {str(e)}")
            return {
                'status': 'error',
                'details': str(e)
            }
    
    def check_internet_connectivity(self):
        """Check if the device is connected to the internet"""
        try:
            # Try multiple reliable hosts
            hosts = [
                ("8.8.8.8", 53),  # Google DNS
                ("1.1.1.1", 53),  # Cloudflare DNS
                ("208.67.222.222", 53)  # OpenDNS
            ]
            
            for host in hosts:
                try:
                    socket.create_connection(host, timeout=2)
                    return {
                        'status': 'connected'
                    }
                except Exception:
                    # Try the next host
                    continue
            
            # If we reach here, we couldn't connect to any host
            # Try ping as fallback
            result = subprocess.run(['ping', '-c', '1', '-W', '2', '8.8.8.8'], 
                                   capture_output=True, text=True)
            if result.returncode == 0:
                return {
                    'status': 'connected'
                }
            
            return {
                'status': 'disconnected',
                'details': 'Failed to connect to internet'
            }
        except Exception as e:
            logger.error(f"Failed to check internet connectivity: {str(e)}")
            return {
                'status': 'disconnected',
                'details': str(e)
            }
    
    def run_all_checks(self):
        """Run all monitoring checks and return the results"""
        results = {
            'timestamp': datetime.now().isoformat(),
            'apc_status': self.check_apc_status(),
            'rtsp_recorder_status': self.check_rtsp_recorder_status(),
            'eth0_status': self.check_eth0_status(),
            'root_mount': self.check_root_mount_mode(),
            'cpu_usage': self.check_cpu_usage(),
            'pending_videos': self.check_pending_videos(),
            'disk_usage': self.check_disk_usage(),
            'ram_usage': self.check_ram_usage(),
            'system_temperature': self.check_system_temperature(),
            'internet_connectivity': self.check_internet_connectivity()
        }
        
        # Check for any critical conditions
        self.check_critical_conditions(results)
        
        return results
    
    def check_critical_conditions(self, results):
        """Check for any critical conditions and log warnings"""
        # Disk space critical if > 90%
        disk_usage = results['disk_usage']
        if 'percent_used' in disk_usage and not isinstance(disk_usage, str) and disk_usage['percent_used'] > 90:
            logger.warning("CRITICAL: Disk usage above 90%!")
        
        # RAM critical if > 85%
        ram_usage = results['ram_usage']
        if 'percent_used' in ram_usage and not isinstance(ram_usage, str) and ram_usage['percent_used'] > 85:
            logger.warning("CRITICAL: RAM usage above 85%!")
            
        # CPU critical if > 95%
        cpu_usage = results['cpu_usage']
        if 'percent_used' in cpu_usage and not isinstance(cpu_usage, str) and cpu_usage['percent_used'] > 95:
            logger.warning("CRITICAL: CPU usage above 95%!")
        
        # Temperature critical if > 80°C
        temp = results['system_temperature']
        if 'temperature_c' in temp and not isinstance(temp, str) and temp['temperature_c'] > 80:
            logger.warning(f"CRITICAL: System temperature is {temp['temperature_c']}°C!")
        
        # Check if internet is disconnected
        internet = results['internet_connectivity']
        if 'status' in internet and internet['status'] == 'disconnected':
            logger.warning("CRITICAL: Internet connection is down!")
            
        # Check if APC is stopped
        apc = results['apc_status']
        if 'status' in apc and apc['status'] == 'stopped':
            logger.warning("CRITICAL: APC service is STOPPED!")
            
        # Check if rtsp_recorder is stopped
        rtsp = results.get('rtsp_recorder_status', {})
        if 'status' in rtsp and rtsp['status'] == 'stopped':
            logger.warning("CRITICAL: RTSP Recorder service is STOPPED!")
            
        # Check if eth0 is down
        eth0 = results.get('eth0_status', {})
        if 'status' in eth0 and eth0['status'] == 'down':
            logger.warning("CRITICAL: eth0 interface is DOWN!")
            
        # Check if root is mounted read-only
        root_mount = results.get('root_mount', {})
        if 'mode' in root_mount and root_mount['mode'] == 'ro':
            logger.warning("CRITICAL: Root filesystem is mounted READ-ONLY!")
            
        # Check if too many pending videos (>100)
        pending = results.get('pending_videos', {})
        if 'count' in pending and isinstance(pending['count'], int) and pending['count'] > 100:
            logger.warning(f"CRITICAL: Too many pending videos: {pending['count']} files!")
            
        # Check if oldest pending video is too old (>24 hours)
        if 'first_file_timestamp' in pending and pending['first_file_timestamp']:
            try:
                oldest_time = datetime.fromisoformat(pending['first_file_timestamp'])
                now = datetime.now()
                age_hours = (now - oldest_time).total_seconds() / 3600
                if age_hours > 24:
                    logger.warning(f"CRITICAL: Oldest pending video is {age_hours:.1f} hours old!")
            except Exception:
                pass
    
    def save_results(self, results):
        """Save the monitoring results to files"""
        try:
            # 1. Save current status to JSON file (overwrite)
            with open(DATA_FILE, 'w') as f:
                json.dump(results, f, indent=2)
            logger.info(f"Current status saved to {DATA_FILE}")
            
            # 2. Append data to main historical CSV file (all records in one file)
            history_file = os.path.join(DATA_DIR, 'all_metrics_history.csv')
            file_exists = os.path.isfile(history_file)
            
            # Extract key metrics for CSV
            timestamp = results['timestamp']
            
            # APC Status
            apc_status = results['apc_status'].get('status', 'unknown')
            
            # RTSP Recorder Status
            rtsp_status = results['rtsp_recorder_status'].get('status', 'unknown')
            
            # eth0 Status
            eth0 = results['eth0_status']
            eth0_status = eth0.get('status', 'unknown')
            eth0_ip = eth0.get('ip_address', 'unknown')
            
            # Root mount mode
            root_mode = results['root_mount'].get('mode', 'unknown')
            
            # CPU Usage
            cpu_usage = results['cpu_usage']
            cpu_percent = cpu_usage.get('percent_used', -1)
            if isinstance(cpu_percent, str):
                cpu_percent = -1
            
            # Pending Videos
            pending = results['pending_videos']
            pending_count = pending.get('count', 0)
            oldest_file = pending.get('first_file_timestamp', '')
            newest_file = pending.get('latest_file_timestamp', '')
            
            # Disk Usage
            disk_usage = results['disk_usage']
            disk_percent = disk_usage.get('percent_used', -1)
            if isinstance(disk_percent, str):
                disk_percent = -1
                
            # RAM Usage
            ram_usage = results['ram_usage']
            ram_percent = ram_usage.get('percent_used', -1)
            if isinstance(ram_percent, str):
                ram_percent = -1
                
            # Temperature
            temperature = results['system_temperature']
            temp_c = temperature.get('temperature_c', -1)
            if isinstance(temp_c, str):
                temp_c = -1
                
            # Internet
            internet = results['internet_connectivity']
            internet_status = internet.get('status', 'unknown')
            
            # Write to CSV - single file with ALL historical data
            with open(history_file, 'a') as f:
                # Write header if file doesn't exist
                if not file_exists:
                    f.write('timestamp,apc_status,rtsp_recorder_status,eth0_status,eth0_ip,root_mount_mode,cpu_percent,pending_videos,oldest_video,newest_video,disk_percent,ram_percent,temperature_c,internet_status\n')
                
                # Write data row
                f.write(f'{timestamp},{apc_status},{rtsp_status},{eth0_status},{eth0_ip},{root_mode},{cpu_percent},{pending_count},{oldest_file},{newest_file},{disk_percent},{ram_percent},{temp_c},{internet_status}\n')
                
            # 3. Save daily reports in reports folder
            try:
                # Extract date from timestamp (YYYY-MM-DD)
                date_str = timestamp.split('T')[0]
                
                # Create reports directory
                reports_dir = os.path.join(DATA_DIR, 'reports')
                os.makedirs(reports_dir, exist_ok=True)
                
                # Daily report file path
                daily_report_file = os.path.join(reports_dir, f'report_{date_str}.csv')
                daily_file_exists = os.path.isfile(daily_report_file)
                
                # Write to daily report CSV file
                with open(daily_report_file, 'a') as f:
                    # Write header if file doesn't exist
                    if not daily_file_exists:
                        f.write('timestamp,apc_status,rtsp_recorder_status,eth0_status,eth0_ip,root_mount_mode,cpu_percent,pending_videos,oldest_video,newest_video,disk_percent,ram_percent,temperature_c,internet_status\n')
                    
                    # Write data row
                    f.write(f'{timestamp},{apc_status},{rtsp_status},{eth0_status},{eth0_ip},{root_mode},{cpu_percent},{pending_count},{oldest_file},{newest_file},{disk_percent},{ram_percent},{temp_c},{internet_status}\n')
            except Exception as e:
                logger.error(f"Error saving daily report: {str(e)}")
                
        except Exception as e:
            logger.error(f"Failed to save monitoring results: {str(e)}")
            # Try to print to stdout as a last resort
            print(json.dumps(results, indent=2))
    
    def monitor(self):
        """Run the monitoring process once"""
        logger.info("Starting monitoring checks...")
        results = self.run_all_checks()
        self.save_results(results)
        logger.info("Monitoring checks completed")
        return results

if __name__ == "__main__":
    try:
        monitor = RaspberryPiMonitor()
        results = monitor.monitor()
        
        # Print a summary of the results
        print("\n===== Raspberry Pi 5 Monitoring Summary =====")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # APC Status
        apc = results['apc_status']
        print(f"APC Status: {apc.get('status', 'unknown')}")
        
        # RTSP Recorder Status
        rtsp = results['rtsp_recorder_status']
        print(f"RTSP Recorder Status: {rtsp.get('status', 'unknown')}")
        
        # eth0 Status
        eth0 = results['eth0_status']
        print(f"eth0 Status: {eth0.get('status', 'unknown')} | IP: {eth0.get('ip_address', 'unknown')}")
        
        # Root mount mode
        root = results['root_mount']
        print(f"Root Mount: {root.get('mode', 'unknown')}")
        
        # CPU Usage
        cpu = results['cpu_usage']
        if 'percent_used' in cpu:
            print(f"CPU Usage: {cpu['percent_used']}% used")
        else:
            print(f"CPU Usage: {cpu.get('status', 'unknown')}")
        
        # Pending Videos
        pending = results['pending_videos']
        if 'count' in pending:
            print(f"Pending Videos: {pending['count']} files")
            if pending['count'] > 0:
                print(f"  Oldest: {pending.get('first_file', 'unknown')} ({pending.get('first_file_timestamp', 'unknown')})")
                print(f"  Newest: {pending.get('latest_file', 'unknown')} ({pending.get('latest_file_timestamp', 'unknown')})")
        else:
            print(f"Pending Videos: {pending.get('status', 'unknown')}")
        
        # Disk Usage
        disk = results['disk_usage']
        if 'percent_used' in disk:
            print(f"Disk Usage: {disk['percent_used']}% used")
        else:
            print(f"Disk Usage: {disk.get('status', 'unknown')}")
        
        # RAM Usage
        ram = results['ram_usage']
        if 'percent_used' in ram:
            print(f"RAM Usage: {ram['percent_used']}% used")
        else:
            print(f"RAM Usage: {ram.get('status', 'unknown')}")
        
        # System Temperature
        temp = results['system_temperature']
        if 'temperature_c' in temp:
            print(f"System Temperature: {temp['temperature_c']}°C")
        else:
            print(f"System Temperature: {temp.get('status', 'unknown')}")
        
        # Internet
        net = results['internet_connectivity']
        print(f"Internet: {net.get('status', 'unknown')}")
        print("============================================")
        
        # Exit with status code 1 if any critical service is stopped or failure condition
        critical_issues = False
        
        if apc.get('status') == 'stopped':
            print("WARNING: APC service is stopped!")
            critical_issues = True
            
        if rtsp.get('status') == 'stopped':
            print("WARNING: RTSP Recorder service is stopped!")
            critical_issues = True
            
        if eth0.get('status') == 'down':
            print("WARNING: eth0 interface is DOWN!")
            critical_issues = True
            
        if root.get('mode') == 'ro':
            print("WARNING: Root filesystem is mounted READ-ONLY!")
            critical_issues = True
            
        # Check if too many pending videos (>100)
        if 'count' in pending and isinstance(pending['count'], int) and pending['count'] > 100:
            print(f"WARNING: Too many pending videos: {pending['count']} files!")
            critical_issues = True
            
        # Check if oldest pending video is too old (>24 hours)
        if 'first_file_timestamp' in pending and pending['first_file_timestamp']:
            try:
                oldest_time = datetime.fromisoformat(pending['first_file_timestamp'])
                now = datetime.now()
                age_hours = (now - oldest_time).total_seconds() / 3600
                if age_hours > 24:
                    print(f"WARNING: Oldest pending video is {age_hours:.1f} hours old!")
                    critical_issues = True
            except Exception:
                pass
        
        if critical_issues:
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Critical error in monitoring service: {str(e)}")
        print(f"Critical error: {str(e)}", file=sys.stderr)
            
        if root.get('mode') == 'ro':
            print("WARNING: Root filesystem is mounted READ-ONLY!")
            critical_issues = True
        
        if critical_issues:
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Critical error in monitoring service: {str(e)}")
        print(f"Critical error: {str(e)}", file=sys.stderr)
        sys.exit(1)
