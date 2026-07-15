/**
 * Intelligent Traffic System (ITS) - Core Application Logic
 * Implements:
 * 1. 2D Intersection Simulator (Canvas-based traffic physics)
 * 2. Computer Vision Motion Detection & Bounding Box overlay
 * 3. Smart Traffic Light State Machine (Fixed Time vs Dynamic AI Mode)
 * 4. Emergency Vehicle Preemption & Web Audio Siren Synthesis
 * 5. Interactive UI controls, file uploads, and Chart.js integrations
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let appState = {
        activeFeed: 'sim',            // 'sim', 'video1', 'video2', or 'upload'
        aiControllerActive: true,      // Toggles dynamic timing adjustments
        cvOverlayEnabled: true,        // Draws bounding boxes and vectors
        sensitivity: 85,               // Motion detection threshold
        lastFrameTime: performance.now(),
        fps: 0,
        stats: {
            totalVehicles: 0,
            avgSpeed: 45,
            waitTimeSaved: 28.4,
            congestionIndex: 15, // 0 - 100
            counts: { cars: 0, trucks: 0, bikes: 0, emergency: 0 }
        },
        emergencyActive: false,
        preemptionLane: 'N',          // Which lane gets the green override
        preemptionTimer: 0
    };

    // --- Audio Context for Siren Sound Effects ---
    let audioCtx = null;
    let sirenInterval = null;

    // --- DOM Elements ---
    const elements = {
        toggleInfoBtn: document.getElementById('toggle-info-btn'),
        closeInfoBtn: document.getElementById('close-info-btn'),
        projectPanel: document.getElementById('project-info-panel'),
        aiToggle: document.getElementById('ai-mode-toggle'),
        cvToggle: document.getElementById('cv-overlay-toggle'),
        sensitivitySlider: document.getElementById('sensitivity-slider'),
        sensitivityVal: document.getElementById('sensitivity-val'),
        resetStatsBtn: document.getElementById('reset-stats-btn'),
        fpsDisplay: document.getElementById('fps-display'),
        simCanvas: document.getElementById('sim-canvas'),
        cvCanvas: document.getElementById('cv-canvas'),
        sirenOverlay: document.getElementById('siren-overlay'),
        monitorVideo: document.getElementById('monitor-video'),
        tabSim: document.getElementById('tab-sim'),
        tabVideo: document.getElementById('tab-video'),
        videoControlBar: document.getElementById('video-control-bar'),
        btnFeedA: document.getElementById('btn-feed-a'),
        btnFeedB: document.getElementById('btn-feed-b'),
        videoFileInput: document.getElementById('video-file-input'),
        videoStatus: document.getElementById('video-status'),
        videoCumulativeRow: document.getElementById('video-cumulative-row'),
        videoCumulativeCount: document.getElementById('video-cumulative-count'),
        triggerEmergencyBtn: document.getElementById('trigger-emergency-btn'),
        clearEmergencyBtn: document.getElementById('clear-emergency-btn'),
        triggerCongestionBtn: document.getElementById('trigger-congestion-btn'),
        consoleLogs: document.getElementById('console-logs'),
        badgeMode: document.getElementById('current-mode-badge'),
        // KPIs
        kpiCongestion: document.getElementById('kpi-congestion'),
        congestionProgress: document.getElementById('congestion-progress'),
        kpiCount: document.getElementById('kpi-count'),
        kpiCountBreakdown: document.getElementById('kpi-count-breakdown'),
        kpiSpeed: document.getElementById('kpi-speed'),
        kpiWaitReduction: document.getElementById('kpi-wait-reduction'),
        // Traffic Light elements
        lightNRed: document.getElementById('light-n-red'),
        lightNYellow: document.getElementById('light-n-yellow'),
        lightNGreen: document.getElementById('light-n-green'),
        timerN: document.getElementById('timer-n'),
        queueN: document.getElementById('queue-n'),
        
        lightERed: document.getElementById('light-e-red'),
        lightEYellow: document.getElementById('light-e-yellow'),
        lightEGreen: document.getElementById('light-e-green'),
        timerE: document.getElementById('timer-e'),
        queueE: document.getElementById('queue-e'),

        lightSRed: document.getElementById('light-s-red'),
        lightSYellow: document.getElementById('light-s-yellow'),
        lightSGreen: document.getElementById('light-s-green'),
        timerS: document.getElementById('timer-s'),
        queueS: document.getElementById('queue-s'),

        lightWRed: document.getElementById('light-w-red'),
        lightWYellow: document.getElementById('light-w-yellow'),
        lightWGreen: document.getElementById('light-w-green'),
        timerW: document.getElementById('timer-w'),
        queueW: document.getElementById('queue-w'),
    };

    // --- Chart Handles ---
    let densityChart = null;
    let cycleChart = null;
    let densityDataPoints = Array(20).fill(15);
    let densityTimeline = Array(20).fill('');

    // --- Hidden Canvas for Pixel Math (Downsampled to 160x120) ---
    const hiddenCanvas = document.createElement('canvas');
    hiddenCanvas.width = 160;
    hiddenCanvas.height = 120;
    const hiddenCtx = hiddenCanvas.getContext('2d');
    let prevFrameData = null;
    let trackedVehicles = [];
    let nextVehicleId = 1;
    let cumulativeVideoCount = 0;

    // --- 2D Simulator Constants & Setup ---
    const simCtx = elements.simCanvas.getContext('2d');
    let vehiclesList = [];
    const roadWidth = 80;
    const centerNS = elements.simCanvas.width / 2; // 320
    const centerEW = elements.simCanvas.height / 2; // 240

    // Traffic Signal Cycles state machine
    let signalController = {
        activePhase: 'N', // 'N', 'E', 'S', 'W' (one green approach at a time)
        state: 'green',     // 'green', 'yellow', 'red' (transition state)
        timeLeft: 12,
        fixedCycleTime: 15,
        yellowTime: 3,
        minGreen: 5,
        maxGreen: 35,
        aiOptimizationCount: 0
    };

    // --- Logger helper ---
    function logEvent(category, text) {
        const time = new Date();
        const timeStr = time.toTimeString().split(' ')[0];
        const logLine = document.createElement('div');
        logLine.className = `log-line ${category.toLowerCase()}`;
        logLine.innerHTML = `[${timeStr}] [${category.toUpperCase()}] ${text}`;
        
        elements.consoleLogs.appendChild(logLine);
        elements.consoleLogs.scrollTop = elements.consoleLogs.scrollHeight;
        
        // Cap logs length
        if (elements.consoleLogs.children.length > 50) {
            elements.consoleLogs.removeChild(elements.consoleLogs.children[0]);
        }
    }

    // --- Project Info Panel Toggles ---
    elements.toggleInfoBtn.addEventListener('click', () => {
        elements.projectPanel.classList.toggle('active');
    });
    
    elements.closeInfoBtn.addEventListener('click', () => {
        elements.projectPanel.classList.remove('active');
    });

    // --- Audio Sound Synthesis (Emergency Siren) ---
    function playSiren() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // Web Audio Oscillators
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'sawtooth';
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();

        let frequencyToggle = true;
        sirenInterval = setInterval(() => {
            if (!appState.emergencyActive) {
                osc.stop();
                clearInterval(sirenInterval);
                sirenInterval = null;
                return;
            }
            // Alternate frequency to sound like emergency response
            osc.frequency.setValueAtTime(frequencyToggle ? 600 : 850, audioCtx.currentTime);
            frequencyToggle = !frequencyToggle;
        }, 300);
    }

    // --- Init Charts ---
    function initCharts() {
        const dCtx = document.getElementById('densityChart').getContext('2d');
        densityChart = new Chart(dCtx, {
            type: 'line',
            data: {
                labels: densityTimeline,
                datasets: [{
                    label: 'Flow Density (Cars/Min)',
                    data: densityDataPoints,
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { display: false } },
                    y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8e9bb3', font: { size: 9 } }, min: 0 }
                }
            }
        });

        const cCtx = document.getElementById('cycleChart').getContext('2d');
        cycleChart = new Chart(cCtx, {
            type: 'bar',
            data: {
                labels: ['NS Phase', 'EW Phase'],
                datasets: [
                    {
                        label: 'Standard Static Cycle',
                        data: [15, 15],
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        borderWidth: 1
                    },
                    {
                        label: 'Dynamic AI Cycle',
                        data: [15, 15],
                        backgroundColor: '#00f5a0',
                        borderColor: 'rgba(0, 245, 160, 0.4)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#8e9bb3', font: { size: 10 } } } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8e9bb3' } },
                    y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8e9bb3', font: { size: 9 } } }
                }
            }
        });
    }

    function updateCharts(density, cycleNS, cycleEW) {
        if (!densityChart || !cycleChart) return;
        
        densityDataPoints.push(density);
        densityDataPoints.shift();
        densityChart.data.datasets[0].data = densityDataPoints;
        densityChart.update('none');

        cycleChart.data.datasets[1].data = [cycleNS, cycleEW];
        cycleChart.update('none');
    }

    // --- Simulator Vehicles & Physics ---
    class SimulatedVehicle {
        constructor(direction) {
            this.direction = direction; // 'N', 'S', 'E', 'W'
            this.id = Math.floor(Math.random() * 10000);
            
            // Random vehicle category
            const rand = Math.random();
            if (rand < 0.65) {
                this.type = 'car';
                this.width = 16;
                this.length = 26;
                this.color = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ec4899'][Math.floor(Math.random() * 5)];
                this.maxSpeed = 3 + Math.random() * 1.5;
            } else if (rand < 0.85) {
                this.type = 'truck';
                this.width = 18;
                this.length = 42;
                this.color = '#8b5cf6';
                this.maxSpeed = 2 + Math.random() * 0.8;
            } else if (rand < 0.97) {
                this.type = 'bike';
                this.width = 8;
                this.length = 16;
                this.color = '#ffd000';
                this.maxSpeed = 4 + Math.random() * 2;
            } else {
                // Emergency Ambulance
                this.type = 'emergency';
                this.width = 18;
                this.length = 32;
                this.color = '#ffffff';
                this.maxSpeed = 5;
            }

            this.speed = this.maxSpeed;
            this.cvClass = this.type.toUpperCase();
            this.cvConf = Math.floor(82 + Math.random() * 16); // Confidence 82-98%
            
            // Initial positioning based on spawn lanes
            switch(direction) {
                case 'S': // Spawn North moving South
                    this.x = centerNS - roadWidth / 4;
                    this.y = -50;
                    break;
                case 'N': // Spawn South moving North
                    this.x = centerNS + roadWidth / 4;
                    this.y = elements.simCanvas.height + 50;
                    break;
                case 'E': // Spawn West moving East
                    this.x = -50;
                    this.y = centerEW + roadWidth / 4;
                    break;
                case 'W': // Spawn East moving West
                    this.x = elements.simCanvas.width + 50;
                    this.y = centerEW - roadWidth / 4;
                    break;
            }
        }

        draw() {
            simCtx.save();
            simCtx.translate(this.x, this.y);
            
            // Rotate canvas context for vehicle orientation
            if (this.direction === 'S') simCtx.rotate(Math.PI);
            if (this.direction === 'E') simCtx.rotate(Math.PI / 2);
            if (this.direction === 'W') simCtx.rotate(-Math.PI / 2);

            // Shadow
            simCtx.fillStyle = 'rgba(0,0,0,0.4)';
            simCtx.fillRect(-this.width/2 + 2, -this.length/2 + 2, this.width, this.length);

            // Chassis
            simCtx.fillStyle = this.color;
            simCtx.fillRect(-this.width/2, -this.length/2, this.width, this.length);

            // Windows & Headlights
            simCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            simCtx.fillRect(-this.width/2 + 2, -this.length/2 + 3, 2, 2); // Headlight L
            simCtx.fillRect(this.width/2 - 4, -this.length/2 + 3, 2, 2);  // Headlight R

            simCtx.fillStyle = '#0f172a'; // Windshield
            simCtx.fillRect(-this.width/2 + 2, -this.length/4, this.width - 4, 6);

            // Flashing Ambulance siren light
            if (this.type === 'emergency') {
                simCtx.fillStyle = (Math.floor(Date.now() / 150) % 2 === 0) ? '#ff3355' : '#00f0ff';
                simCtx.beginPath();
                simCtx.arc(0, 0, 5, 0, Math.PI * 2);
                simCtx.fill();
                
                // Red Cross decal
                simCtx.fillStyle = '#ff3355';
                simCtx.fillRect(-2, -this.length/6 - 5, 4, 10);
                simCtx.fillRect(-5, -this.length/6 - 2, 10, 4);
            }

            simCtx.restore();
        }

        update(vehiclesInLane) {
            let targetSpeed = this.maxSpeed;
            let stopLine = 0;
            let currentLight = 'red';
            
            // Check light signals & stopping rules (Indian 4-Phase System: 1 green at a time)
            let isLaneActive = false;
            if (this.direction === 'S' && signalController.activePhase === 'N') isLaneActive = true;
            if (this.direction === 'N' && signalController.activePhase === 'S') isLaneActive = true;
            if (this.direction === 'E' && signalController.activePhase === 'W') isLaneActive = true;
            if (this.direction === 'W' && signalController.activePhase === 'E') isLaneActive = true;

            currentLight = isLaneActive ? signalController.state : 'red';

            // Adjust targets if Emergency mode overrides signal logic
            if (appState.emergencyActive && this.type === 'emergency') {
                currentLight = 'green';
            }

            let stopPoint = null;
            // Stop lines coordinates
            switch(this.direction) {
                case 'S':
                    stopPoint = centerEW - roadWidth/2 - 10;
                    if (this.y < stopPoint && this.y > stopPoint - 150 && currentLight !== 'green' && !(appState.emergencyActive && appState.preemptionLane === 'N')) {
                        targetSpeed = 0;
                    }
                    break;
                case 'N':
                    stopPoint = centerEW + roadWidth/2 + 10;
                    if (this.y > stopPoint && this.y < stopPoint + 150 && currentLight !== 'green' && !(appState.emergencyActive && appState.preemptionLane === 'S')) {
                        targetSpeed = 0;
                    }
                    break;
                case 'E':
                    stopPoint = centerNS - roadWidth/2 - 10;
                    if (this.x < stopPoint && this.x > stopPoint - 150 && currentLight !== 'green' && !(appState.emergencyActive && appState.preemptionLane === 'W')) {
                        targetSpeed = 0;
                    }
                    break;
                case 'W':
                    stopPoint = centerNS + roadWidth/2 + 10;
                    if (this.x > stopPoint && this.x < stopPoint + 150 && currentLight !== 'green' && !(appState.emergencyActive && appState.preemptionLane === 'E')) {
                        targetSpeed = 0;
                    }
                    break;
            }

            // Safety spacing - check vehicle ahead
            let vehicleAhead = null;
            let minDistance = 9999;
            
            vehiclesInLane.forEach(other => {
                if (other.id === this.id) return;
                
                let dist = 9999;
                if (this.direction === 'S' && other.y > this.y) dist = other.y - this.y;
                if (this.direction === 'N' && other.y < this.y) dist = this.y - other.y;
                if (this.direction === 'E' && other.x > this.x) dist = other.x - this.x;
                if (this.direction === 'W' && other.x < this.x) dist = this.x - other.x;
                
                if (dist < minDistance) {
                    minDistance = dist;
                    vehicleAhead = other;
                }
            });

            // Adjust speed to prevent tailgating or crash
            const safetyBuffer = this.length + 12;
            if (vehicleAhead && minDistance < safetyBuffer) {
                if (minDistance < this.length + 6) {
                    targetSpeed = 0; // stop immediately
                } else {
                    targetSpeed = Math.min(targetSpeed, vehicleAhead.speed * 0.85);
                }
            }

            // Acceleration & Deceleration physics
            if (this.speed < targetSpeed) {
                this.speed += 0.15;
            } else if (this.speed > targetSpeed) {
                this.speed -= 0.25;
            }
            if (this.speed < 0) this.speed = 0;

            // Apply movement
            switch(this.direction) {
                case 'S': this.y += this.speed; break;
                case 'N': this.y -= this.speed; break;
                case 'E': this.x += this.speed; break;
                case 'W': this.x -= this.speed; break;
            }
        }

        isOffscreen() {
            return (
                this.x < -100 || 
                this.x > elements.simCanvas.width + 100 || 
                this.y < -100 || 
                this.y > elements.simCanvas.height + 100
            );
        }
    }

    // --- Draw Road System ---
    function drawIntersectionLayout() {
        // Clearing Canvas with dark slate asphalt color
        simCtx.fillStyle = '#171e2e';
        simCtx.fillRect(0, 0, elements.simCanvas.width, elements.simCanvas.height);

        // Pedestrian Footwalk boundaries
        simCtx.fillStyle = '#111726';
        // Corners
        simCtx.fillRect(0, 0, centerNS - roadWidth/2, centerEW - roadWidth/2);
        simCtx.fillRect(centerNS + roadWidth/2, 0, centerNS - roadWidth/2, centerEW - roadWidth/2);
        simCtx.fillRect(0, centerEW + roadWidth/2, centerNS - roadWidth/2, centerEW - roadWidth/2);
        simCtx.fillRect(centerNS + roadWidth/2, centerEW + roadWidth/2, centerNS - roadWidth/2, centerEW - roadWidth/2);

        // Road Lines (Yellow middle line)
        simCtx.strokeStyle = '#eab308';
        simCtx.lineWidth = 2;
        simCtx.setLineDash([8, 8]);
        
        // NS Divider
        simCtx.beginPath();
        simCtx.moveTo(centerNS, 0);
        simCtx.lineTo(centerNS, centerEW - roadWidth/2);
        simCtx.moveTo(centerNS, centerEW + roadWidth/2);
        simCtx.lineTo(centerNS, elements.simCanvas.height);
        // EW Divider
        simCtx.moveTo(0, centerEW);
        simCtx.lineTo(centerNS - roadWidth/2, centerEW);
        simCtx.moveTo(centerNS + roadWidth/2, centerEW);
        simCtx.lineTo(elements.simCanvas.width, centerEW);
        simCtx.stroke();
        simCtx.setLineDash([]); // Reset line dash

        // Lanes dividers (White dotted lines for multiple lanes if any)
        simCtx.strokeStyle = 'rgba(255,255,255,0.1)';
        simCtx.lineWidth = 1;
        simCtx.beginPath();
        // Lane guides
        simCtx.moveTo(centerNS - roadWidth/4, 0); simCtx.lineTo(centerNS - roadWidth/4, centerEW - roadWidth/2);
        simCtx.moveTo(centerNS + roadWidth/4, 0); simCtx.lineTo(centerNS + roadWidth/4, centerEW - roadWidth/2);
        simCtx.stroke();

        // Stop lines (Solid White)
        simCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        simCtx.lineWidth = 3;
        simCtx.beginPath();
        // N Stop line
        simCtx.moveTo(centerNS, centerEW - roadWidth/2 - 2);
        simCtx.lineTo(centerNS - roadWidth/2, centerEW - roadWidth/2 - 2);
        // S Stop line
        simCtx.moveTo(centerNS, centerEW + roadWidth/2 + 2);
        simCtx.lineTo(centerNS + roadWidth/2, centerEW + roadWidth/2 + 2);
        // E Stop Line
        simCtx.moveTo(centerNS - roadWidth/2 - 2, centerEW);
        simCtx.lineTo(centerNS - roadWidth/2 - 2, centerEW + roadWidth/2);
        // W Stop Line
        simCtx.moveTo(centerNS + roadWidth/2 + 2, centerEW);
        simCtx.lineTo(centerNS + roadWidth/2 + 2, centerEW - roadWidth/2);
        simCtx.stroke();

        // Draw Pedestrian Crosswalks (Zebra Stripes)
        simCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        const drawZebra = (startX, startY, isHorizontal) => {
            for (let i = 0; i < 6; i++) {
                if (isHorizontal) {
                    simCtx.fillRect(startX + i * 12, startY, 6, roadWidth - 4);
                } else {
                    simCtx.fillRect(startX, startY + i * 12, roadWidth - 4, 6);
                }
            }
        };

        // Draw crosswalk elements
        drawZebra(centerNS - roadWidth/2 + 2, centerEW - roadWidth/2 - 18, true); // North Crossing
        drawZebra(centerNS - roadWidth/2 + 2, centerEW + roadWidth/2 + 8, true);  // South Crossing
        drawZebra(centerNS - roadWidth/2 - 18, centerEW - roadWidth/2 + 2, false); // West Crossing
        drawZebra(centerNS + roadWidth/2 + 8, centerEW - roadWidth/2 + 2, false);  // East Crossing

        // Helper to draw physical 3-light signals on the corners
        const drawTrafficLightDevice = (x, y, laneType) => {
            // Draw pole/mounting bracket
            simCtx.fillStyle = '#64748b'; // slate grey pole
            simCtx.fillRect(x + 5, y + 36, 4, 15);
            simCtx.fillStyle = '#334155'; // pole base
            simCtx.fillRect(x + 2, y + 50, 10, 4);

            // Draw housing (rounded rectangle)
            simCtx.fillStyle = '#0f172a'; // black body
            simCtx.strokeStyle = '#334155';
            simCtx.lineWidth = 1.5;
            simCtx.beginPath();
            simCtx.roundRect(x, y, 14, 38, 4);
            simCtx.fill();
            simCtx.stroke();

            // Determine light active states
            let isRed = false;
            let isYellow = false;
            let isGreen = false;

            if (laneType === signalController.activePhase) {
                if (signalController.state === 'green') isGreen = true;
                else if (signalController.state === 'yellow') isYellow = true;
            } else {
                isRed = true;
            }

            // Draw Lenses
            // Red Lens (Top)
            simCtx.fillStyle = isRed ? '#ff3355' : '#331118';
            if (isRed) {
                simCtx.save();
                simCtx.shadowColor = '#ff3355';
                simCtx.shadowBlur = 10;
            }
            simCtx.beginPath();
            simCtx.arc(x + 7, y + 8, 4, 0, Math.PI * 2);
            simCtx.fill();
            if (isRed) simCtx.restore();

            // Yellow Lens (Middle)
            simCtx.fillStyle = isYellow ? '#ffb800' : '#332500';
            if (isYellow) {
                simCtx.save();
                simCtx.shadowColor = '#ffb800';
                simCtx.shadowBlur = 10;
            }
            simCtx.beginPath();
            simCtx.arc(x + 7, y + 19, 4, 0, Math.PI * 2);
            simCtx.fill();
            if (isYellow) simCtx.restore();

            // Green Lens (Bottom)
            simCtx.fillStyle = isGreen ? '#00f5a0' : '#00331f';
            if (isGreen) {
                simCtx.save();
                simCtx.shadowColor = '#00f5a0';
                simCtx.shadowBlur = 12;
            }
            simCtx.beginPath();
            simCtx.arc(x + 7, y + 30, 4, 0, Math.PI * 2);
            simCtx.fill();
            if (isGreen) simCtx.restore();
        };

        // Render signals on the 4 corners of the intersection
        drawTrafficLightDevice(centerNS - roadWidth/2 - 26, centerEW - roadWidth/2 - 64, 'N'); // Top-Left Corner (North Signal)
        drawTrafficLightDevice(centerNS + roadWidth/2 + 12, centerEW - roadWidth/2 - 64, 'E'); // Top-Right Corner (East Signal)
        drawTrafficLightDevice(centerNS + roadWidth/2 + 12, centerEW + roadWidth/2 + 12, 'S'); // Bottom-Right Corner (South Signal)
        drawTrafficLightDevice(centerNS - roadWidth/2 - 26, centerEW + roadWidth/2 + 12, 'W'); // Bottom-Left Corner (West Signal) // Top-Right Corner (EW Signal)
    }

    // --- Simulated Traffic Generation ---
    function spawnVehicle(lane) {
        vehiclesList.push(new SimulatedVehicle(lane));
    }

    // --- Smart Signal State Machine Controller ---
    function updateSignalTimers(dt) {
        signalController.timeLeft -= dt;

        if (signalController.timeLeft <= 0) {
            // Signal Phase transitions
            if (signalController.state === 'green') {
                signalController.state = 'yellow';
                signalController.timeLeft = signalController.yellowTime;
                logEvent('system', `Phase ${signalController.activePhase} switching to YELLOW clearance window.`);
            } else if (signalController.state === 'yellow') {
                // Switch phase active lane (Indian 4-Phase System)
                const phases = ['N', 'E', 'S', 'W'];
                const currentIndex = phases.indexOf(signalController.activePhase);
                signalController.activePhase = phases[(currentIndex + 1) % 4];
                signalController.state = 'green';
                
                // Recalculate timing based on mode
                let nextGreenTime = signalController.fixedCycleTime;
                
                if (appState.aiControllerActive) {
                    const currentQueue = getQueueCount(signalController.activePhase);
                    
                    // Check other queues to see if we should skip
                    let otherQueues = 0;
                    ['N', 'E', 'S', 'W'].forEach(p => {
                        if (p !== signalController.activePhase) otherQueues += getQueueCount(p);
                    });
                    
                    if (currentQueue > 4) {
                        nextGreenTime = Math.min(signalController.maxGreen, 15 + (currentQueue - 4) * 3);
                        signalController.aiOptimizationCount++;
                        logEvent('ai', `High queue in Phase ${signalController.activePhase} (${currentQueue} vehicles). Dynamic timing extended green to ${nextGreenTime}s.`);
                    } else if (currentQueue === 0 && otherQueues > 0) {
                        nextGreenTime = signalController.minGreen;
                        signalController.aiOptimizationCount++;
                        logEvent('ai', `Phase ${signalController.activePhase} clear. Truncating green window to ${signalController.minGreen}s to clear other lanes.`);
                    }
                }
                
                signalController.timeLeft = nextGreenTime;
                logEvent('system', `Phase ${signalController.activePhase} Green active for ${nextGreenTime} seconds.`);
            }
        }

        // Apply emergency preemption override active timers
        if (appState.emergencyActive) {
            signalController.timeLeft = Math.max(0, signalController.timeLeft);
        }

        // Render light visual representation
        updateTrafficLightUI();
    }

    function getQueueCount(lane) {
        let count = 0;
        vehiclesList.forEach(v => {
            if (v.speed === 0) {
                if (lane === 'N' && v.direction === 'S') count++;
                if (lane === 'S' && v.direction === 'N') count++;
                if (lane === 'E' && v.direction === 'W') count++;
                if (lane === 'W' && v.direction === 'E') count++;
            }
        });
        return count;
    }

    function updateTrafficLightUI() {
        const lanes = ['n', 'e', 's', 'w'];
        
        lanes.forEach(l => {
            const phaseUpper = l.toUpperCase();
            
            // Remove active classes
            elements[`light${phaseUpper}Red`].classList.remove('active');
            elements[`light${phaseUpper}Yellow`].classList.remove('active');
            elements[`light${phaseUpper}Green`].classList.remove('active');
            
            // Apply visual classes
            if (signalController.activePhase === phaseUpper) {
                if (signalController.state === 'green') {
                    elements[`light${phaseUpper}Green`].classList.add('active');
                    elements[`timer${phaseUpper}`].innerText = `${Math.ceil(signalController.timeLeft)}s`;
                } else if (signalController.state === 'yellow') {
                    elements[`light${phaseUpper}Yellow`].classList.add('active');
                    elements[`timer${phaseUpper}`].innerText = `${Math.ceil(signalController.timeLeft)}s`;
                }
            } else {
                elements[`light${phaseUpper}Red`].classList.add('active');
                elements[`timer${phaseUpper}`].innerText = 'WAIT';
            }
            
            // Display queue numbers
            elements[`queue${phaseUpper}`].innerText = getQueueCount(phaseUpper);
        });
    }

    // --- Computer Vision Pixel Processing (Frame Differencing) ---
    const cvCtx = elements.cvCanvas.getContext('2d');
    
    // Config bounding boxes parameters
    let simulatedDetections = [];

    function processCVFrame(sourceElement) {
        if (!appState.cvOverlayEnabled) {
            cvCtx.clearRect(0, 0, elements.cvCanvas.width, elements.cvCanvas.height);
            return;
        }

        cvCtx.clearRect(0, 0, elements.cvCanvas.width, elements.cvCanvas.height);

        if (appState.activeFeed === 'sim') {
            // --- 2D Simulation Overlay (Simulated YOLOv8 coordinates) ---
            vehiclesList.forEach((v, index) => {
                const detectionThreshold = (100 - appState.sensitivity) * 1.2;
                const randSeed = (v.id % 100);
                if (randSeed < detectionThreshold) return;

                const jitterX = (Math.sin(Date.now() / 80 + v.id) * 1.5);
                const jitterY = (Math.cos(Date.now() / 80 + v.id) * 1.5);
                
                let bx, by, bw, bh;
                if (v.direction === 'N' || v.direction === 'S') {
                    bw = v.width + 4;
                    bh = v.length + 4;
                    bx = v.x - bw/2 + jitterX;
                    by = v.y - bh/2 + jitterY;
                } else {
                    bw = v.length + 4;
                    bh = v.width + 4;
                    bx = v.x - bw/2 + jitterX;
                    by = v.y - bh/2 + jitterY;
                }

                // Draw bounding box
                cvCtx.strokeStyle = '#00f0ff';
                cvCtx.lineWidth = 1.5;
                cvCtx.strokeRect(bx, by, bw, bh);

                cvCtx.save();
                cvCtx.shadowColor = '#00f0ff';
                cvCtx.shadowBlur = 6;
                cvCtx.strokeRect(bx, by, bw, bh);
                cvCtx.restore();

                // Draw tracking vector arrow
                cvCtx.beginPath();
                cvCtx.strokeStyle = '#22c55e'; // green tracking vector
                cvCtx.lineWidth = 1.5;
                cvCtx.moveTo(v.x, v.y);
                let arrowLength = 20;
                if (v.direction === 'S') cvCtx.lineTo(v.x, v.y + arrowLength);
                if (v.direction === 'N') cvCtx.lineTo(v.x, v.y - arrowLength);
                if (v.direction === 'E') cvCtx.lineTo(v.x + arrowLength, v.y);
                if (v.direction === 'W') cvCtx.lineTo(v.x - arrowLength, v.y);
                cvCtx.stroke();

                const conf = Math.round(85 + (v.id % 14));
                let label = v.type.toUpperCase();
                if (label === 'EMERGENCY') label = 'AMBULANCE';
                
                cvCtx.fillStyle = 'rgba(0, 240, 255, 0.85)';
                cvCtx.fillRect(bx, by - 14, Math.max(75, bw), 14);

                cvCtx.fillStyle = '#0f172a';
                cvCtx.font = '900 8.5px "JetBrains Mono", monospace';
                cvCtx.fillText(`${label} [${conf}%]`, bx + 3, by - 4);

                cvCtx.beginPath();
                cvCtx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
                cvCtx.arc(v.x, v.y, 4, 0, Math.PI * 2);
                cvCtx.stroke();
            });
        } else {
            // --- Real Video Analytics Overlay (Frame-differencing & clustering) ---
            const width = hiddenCanvas.width;
            const height = hiddenCanvas.height;
            
            try {
                hiddenCtx.drawImage(sourceElement, 0, 0, width, height);
                const frame = hiddenCtx.getImageData(0, 0, width, height);
                const data = frame.data;

                // Adjust threshold based on sensitivity
                let motionThreshold = (100 - appState.sensitivity) * 4.5;
                let activeCells = [];

                if (prevFrameData) {
                    for (let y = 0; y < height; y += 4) {
                        for (let x = 0; x < width; x += 4) {
                            const idx = (y * width + x) * 4;
                            
                            const diffR = Math.abs(data[idx] - prevFrameData[idx]);
                            const diffG = Math.abs(data[idx+1] - prevFrameData[idx+1]);
                            const diffB = Math.abs(data[idx+2] - prevFrameData[idx+2]);
                            const delta = diffR + diffG + diffB;

                            if (delta > motionThreshold) {
                                activeCells.push({ x, y });
                            }
                        }
                    }
                }
                prevFrameData = data;

                // Simple clustering/blob grouping of active cells
                let blobs = [];
                let cellChecked = new Set();
                const cellDistThreshold = 6;

                activeCells.forEach(cell => {
                    const cellKey = `${cell.x},${cell.y}`;
                    if (cellChecked.has(cellKey)) return;

                    let blob = { minX: cell.x, maxX: cell.x, minY: cell.y, maxY: cell.y, points: [cell] };
                    let queue = [cell];
                    cellChecked.add(cellKey);

                    while (queue.length > 0) {
                        let current = queue.shift();
                        
                        activeCells.forEach(neighbor => {
                            const neighborKey = `${neighbor.x},${neighbor.y}`;
                            if (cellChecked.has(neighborKey)) return;

                            const dx = Math.abs(current.x - neighbor.x);
                            const dy = Math.abs(current.y - neighbor.y);
                            if (dx <= cellDistThreshold && dy <= cellDistThreshold) {
                                cellChecked.add(neighborKey);
                                queue.push(neighbor);
                                
                                blob.minX = Math.min(blob.minX, neighbor.x);
                                blob.maxX = Math.max(blob.maxX, neighbor.x);
                                blob.minY = Math.min(blob.minY, neighbor.y);
                                blob.maxY = Math.max(blob.maxY, neighbor.y);
                                blob.points.push(neighbor);
                            }
                        });
                    }

                    const w = blob.maxX - blob.minX;
                    const h = blob.maxY - blob.minY;
                    const minPoints = Math.max(3, Math.round(10 - (appState.sensitivity - 50) * 0.15));
                    if (w > 1 && h > 1 && blob.points.length > minPoints) {
                        blobs.push(blob);
                    }
                });

                const scaleX = elements.cvCanvas.width / width;
                const scaleY = elements.cvCanvas.height / height;

                // --- Map current blobs to centroids & bounds objects ---
                let currentCentroids = [];
                blobs.forEach((blob, index) => {
                    let bw = Math.max(16, (blob.maxX - blob.minX + 1.2) * scaleX);
                    let bh = Math.max(16, (blob.maxY - blob.minY + 1.2) * scaleY);
                    let bx = blob.minX * scaleX - 2;
                    let by = blob.minY * scaleY - 2;
                    
                    let cx = bx + bw / 2;
                    let cy = by + bh / 2;
                    
                    // Object classification based on bounding box dimensions and screen position (perspective-aware)
                    let label = 'CAR';
                    const twoWheelerThreshold = cy < elements.cvCanvas.height * 0.45 ? 18 : 38;
                    const heavyTruckThreshold = cy < elements.cvCanvas.height * 0.45 ? 4000 : 12000;

                    if (bw * bh > heavyTruckThreshold) {
                        label = 'HEAVY TRUCK';
                    } else if (bw < twoWheelerThreshold || bh < twoWheelerThreshold) {
                        label = 'TWO-WHEELER';
                    }

                    // Confidence score
                    const confidence = Math.round(80 + (index * 7 + 4) % 18);

                    currentCentroids.push({ 
                        x: cx, 
                        y: cy, 
                        bx, 
                        by, 
                        bw, 
                        bh, 
                        label, 
                        confidence, 
                        matched: false 
                    });
                });

                // Match current centroids with existing tracked vehicles
                trackedVehicles.forEach(tv => {
                    tv.matched = false;
                    tv.framesSinceLastSeen++;
                });

                currentCentroids.forEach(cc => {
                    let bestMatch = null;
                    let minDistance = 45; // pixel matching radius

                    trackedVehicles.forEach(tv => {
                        let dist = Math.hypot(cc.x - tv.x, cc.y - tv.y);
                        if (dist < minDistance) {
                            minDistance = dist;
                            bestMatch = tv;
                        }
                    });

                    if (bestMatch) {
                        bestMatch.x = cc.x;
                        bestMatch.y = cc.y;
                        bestMatch.bx = cc.bx;
                        bestMatch.by = cc.by;
                        bestMatch.bw = cc.bw;
                        bestMatch.bh = cc.bh;
                        bestMatch.label = cc.label;
                        bestMatch.confidence = cc.confidence;
                        bestMatch.framesSinceLastSeen = 0;
                        bestMatch.matched = true;
                        cc.matched = true;
                    }
                });

                // Add newly detected centroids as new tracked vehicles
                currentCentroids.forEach(cc => {
                    if (!cc.matched) {
                        trackedVehicles.push({
                            id: nextVehicleId++,
                            x: cc.x,
                            y: cc.y,
                            bx: cc.bx,
                            by: cc.by,
                            bw: cc.bw,
                            bh: cc.bh,
                            label: cc.label,
                            confidence: cc.confidence,
                            framesSinceLastSeen: 0,
                            matched: true
                        });
                        cumulativeVideoCount++;
                        logEvent('system', `[AI-DETECTOR] New vehicle identified (ID #${nextVehicleId - 1}). Total cumulative video count: ${cumulativeVideoCount}`);
                    }
                });

                // Clean up tracked vehicles that went off screen or became stale
                const boundaryThreshold = 25; // pixels from screen boundary
                trackedVehicles = trackedVehicles.filter(tv => {
                    const isNearEdge = tv.x < boundaryThreshold || 
                                       tv.x > elements.cvCanvas.width - boundaryThreshold || 
                                       tv.y < boundaryThreshold || 
                                       tv.y > elements.cvCanvas.height - boundaryThreshold;
                                       
                    return tv.framesSinceLastSeen < 20 && !isNearEdge;
                });

                // Update cumulative GUI counter
                elements.videoCumulativeCount.innerText = cumulativeVideoCount;

                // Draw tracked bounding boxes on screen & update counters
                let detectedCars = 0;
                let detectedTrucks = 0;
                let detectedBikes = 0;

                trackedVehicles.forEach(tv => {
                    // Update KPI counters
                    if (tv.label === 'HEAVY TRUCK') detectedTrucks++;
                    else if (tv.label === 'TWO-WHEELER') detectedBikes++;
                    else detectedCars++;

                    let bx = tv.bx;
                    let by = tv.by;
                    let bw = tv.bw;
                    let bh = tv.bh;

                    // Draw bounding box (slight transparency if predicted/not seen in this frame)
                    cvCtx.strokeStyle = tv.framesSinceLastSeen > 0 ? 'rgba(0, 240, 255, 0.45)' : '#00f0ff';
                    cvCtx.lineWidth = 1.5;
                    cvCtx.strokeRect(bx, by, bw, bh);

                    cvCtx.save();
                    cvCtx.shadowColor = '#00f0ff';
                    cvCtx.shadowBlur = tv.framesSinceLastSeen > 0 ? 2 : 6;
                    cvCtx.strokeRect(bx, by, bw, bh);
                    cvCtx.restore();

                    // Label tag background
                    cvCtx.fillStyle = tv.framesSinceLastSeen > 0 ? 'rgba(0, 240, 255, 0.4)' : 'rgba(0, 240, 255, 0.85)';
                    cvCtx.fillRect(bx, by - 14, Math.max(75, bw), 14);

                    // Label tag text
                    cvCtx.fillStyle = tv.framesSinceLastSeen > 0 ? 'rgba(15, 23, 42, 0.6)' : '#0f172a';
                    cvCtx.font = '900 8.5px "JetBrains Mono", monospace';
                    cvCtx.fillText(`${tv.label} [${tv.confidence}%]`, bx + 3, by - 4);
                });

                // Sync metrics from real video CV engine to dashboard
                appState.stats.counts.cars = detectedCars;
                appState.stats.counts.trucks = detectedTrucks;
                appState.stats.counts.bikes = detectedBikes;
                appState.stats.totalVehicles = detectedCars + detectedTrucks + detectedBikes;
                appState.stats.congestionIndex = Math.min(100, Math.round((detectedCars + detectedTrucks * 1.5 + detectedBikes * 0.5) * 8.5));
                appState.stats.avgSpeed = Math.round(35 + (detectedCars % 3) * 4); // Simulated average speed
            } catch (e) {
                console.error("Video frame processing error: ", e);
            }
        }
    }

    // --- UI Metrics Display updates ---
    function updateMetricsUI() {
        // Congestion KPI
        elements.kpiCongestion.innerText = getCongestionLabel(appState.stats.congestionIndex);
        elements.kpiCongestion.className = `kpi-val ${getCongestionClass(appState.stats.congestionIndex)}`;
        
        elements.congestionProgress.style.width = `${appState.stats.congestionIndex}%`;
        elements.congestionProgress.className = `progress-bar ${getCongestionBgClass(appState.stats.congestionIndex)}`;

        // Counts
        elements.kpiCount.innerText = appState.stats.totalVehicles;
        
        // Breakdown text
        elements.kpiCountBreakdown.innerText = `Cars: ${appState.stats.counts.cars} | Trucks: ${appState.stats.counts.trucks} | Bikes: ${appState.stats.counts.bikes}`;

        // Speeds
        elements.kpiSpeed.innerHTML = `${appState.stats.avgSpeed} <small>km/h</small>`;
        
        // Wait reduction percentage
        elements.kpiWaitReduction.innerText = `${appState.stats.waitTimeSaved}%`;
    }

    function getCongestionLabel(index) {
        if (index < 20) return 'LOW';
        if (index < 50) return 'MEDIUM';
        if (index < 80) return 'HIGH';
        return 'CRITICAL';
    }

    function getCongestionClass(index) {
        if (index < 20) return 'text-green';
        if (index < 50) return 'text-yellow';
        if (index < 80) return 'text-red';
        return 'text-red blink-glow';
    }

    function getCongestionBgClass(index) {
        if (index < 20) return 'bg-green';
        if (index < 50) return 'bg-yellow';
        return 'bg-red';
    }

    // --- Main Simulator Draw Loop ---
    function runSimulationLoop() {
        const now = performance.now();
        const dt = (now - appState.lastFrameTime) / 1000;
        appState.lastFrameTime = now;

        // FPS meter
        appState.fps = Math.round(1 / dt);
        if (now % 10 < 1) {
            elements.fpsDisplay.innerText = `FPS: ${appState.fps}`;
        }

        if (appState.activeFeed === 'sim') {
            // --- 2D Intersection Simulator ---
            // Draw background & roads
            drawIntersectionLayout();

            // Lanes grouping
            let lanes = { N: [], S: [], E: [], W: [] };
            vehiclesList.forEach(v => lanes[v.direction].push(v));

            // Update & Draw vehicles
            vehiclesList.forEach(v => {
                v.update(lanes[v.direction]);
                v.draw();
            });

            // Filter out off-screen vehicles
            const prevLen = vehiclesList.length;
            vehiclesList = vehiclesList.filter(v => {
                const off = v.isOffscreen();
                if (off) {
                    appState.stats.totalVehicles++;
                }
                return !off;
            });

            // Auto spawn simulation vehicles randomly
            const spawnChance = 0.015; // frequency weight
            if (Math.random() < spawnChance && vehiclesList.length < 14) {
                const lanesDirs = ['N', 'S', 'E', 'W'];
                const selectedDir = lanesDirs[Math.floor(Math.random() * lanesDirs.length)];
                spawnVehicle(selectedDir);
            }

            // Sync metrics based on current simulator status
            let carC = 0, truckC = 0, bikeC = 0;
            vehiclesList.forEach(v => {
                if (v.type === 'car') carC++;
                if (v.type === 'truck') truckC++;
                if (v.type === 'bike') bikeC++;
            });
            appState.stats.counts.cars = carC;
            appState.stats.counts.trucks = truckC;
            appState.stats.counts.bikes = bikeC;

            // Congestion = current vehicle density on lanes
            appState.stats.congestionIndex = Math.min(100, Math.round(vehiclesList.length * 7.5));
            
            // Average speed computation
            let totalSpeed = 0;
            vehiclesList.forEach(v => totalSpeed += v.speed);
            const simulatedAvg = vehiclesList.length > 0 ? (totalSpeed / vehiclesList.length) * 15 : 45;
            appState.stats.avgSpeed = Math.round(simulatedAvg);

            updateMetricsUI();

            // Run computer vision overlays directly targeting simulation canvas!
            processCVFrame(elements.simCanvas);

            // Traffic Light timers
            updateSignalTimers(dt);

            // Automatic Emergency Vehicle detection & preemption override
            const emergencyVehicles = vehiclesList.filter(v => v.type === 'emergency');
            if (emergencyVehicles.length > 0) {
                const firstAmbulance = emergencyVehicles[0];
                
                // Map direction to approach lane
                let lane = 'N';
                if (firstAmbulance.direction === 'N') lane = 'S';
                if (firstAmbulance.direction === 'E') lane = 'W';
                if (firstAmbulance.direction === 'W') lane = 'E';

                // Trigger emergency mode automatically for this lane
                if (!appState.emergencyActive || appState.preemptionLane !== lane) {
                    triggerEmergencyMode(lane, false);
                }
                
                // Lock the countdown timer at 8 seconds until the vehicle is off screen
                appState.preemptionTimer = 8;
            } else if (appState.emergencyActive) {
                // Once ambulance clears, restrict clear time to 3 seconds
                if (appState.preemptionTimer > 3) {
                    appState.preemptionTimer = 3;
                }
                appState.preemptionTimer -= dt;
                if (appState.preemptionTimer <= 0) {
                    disableEmergencyMode();
                }
            }
        } else {
            // --- Real Video Analytics ---
            if (elements.monitorVideo.readyState >= 2) {
                // Draw current video frame to sim-canvas
                simCtx.drawImage(elements.monitorVideo, 0, 0, elements.simCanvas.width, elements.simCanvas.height);
                
                // Run motion analysis and draw overlays
                processCVFrame(elements.monitorVideo);
            } else {
                // Video loading state
                simCtx.fillStyle = '#111726';
                simCtx.fillRect(0, 0, elements.simCanvas.width, elements.simCanvas.height);
                
                simCtx.fillStyle = 'rgba(255,255,255,0.7)';
                simCtx.font = '500 13px "Outfit", sans-serif';
                simCtx.textAlign = 'center';
                simCtx.fillText('No video feed playing. Choose Feed A/B or upload an MP4/WebM local file.', elements.simCanvas.width / 2, elements.simCanvas.height / 2);
                simCtx.textAlign = 'left';
            }
            
            // Still update the indicators dashboard
            updateMetricsUI();
        }

        // Loop next frame animation
        requestAnimationFrame(runSimulationLoop);
    }

    // --- Emergency preemption overrides ---
    function triggerEmergencyMode(targetLane = 'N', autoSpawn = false) {
        if (appState.emergencyActive && appState.preemptionLane === targetLane) return; // already active

        appState.emergencyActive = true;
        appState.preemptionTimer = 8; // Clears in 8 seconds
        
        appState.preemptionLane = targetLane;
        signalController.activePhase = targetLane;
        signalController.state = 'green';
        signalController.timeLeft = 8;

        elements.sirenOverlay.classList.add('active');
        
        let laneText = "NORTH";
        if (targetLane === 'S') laneText = "SOUTH";
        if (targetLane === 'E') laneText = "EAST";
        if (targetLane === 'W') laneText = "WEST";
        logEvent('emergency', `🚑 IOT EMERGENCY VEHICLE DETECTED ON ${laneText} LANE! Preemption override active.`);

        // Spawn emergency vehicle in simulator if triggered manually
        if (autoSpawn) {
            let spawnDirection = 'S'; // North approach
            if (targetLane === 'S') spawnDirection = 'N';
            if (targetLane === 'E') spawnDirection = 'W';
            if (targetLane === 'W') spawnDirection = 'E';

            const ambulance = new SimulatedVehicle(spawnDirection);
            ambulance.type = 'emergency';
            ambulance.color = '#ffffff';
            ambulance.maxSpeed = 6.0;
            ambulance.speed = 6.0;
            vehiclesList.push(ambulance);
        }

        // Sound siren audio synth
        playSiren();
    }

    function disableEmergencyMode() {
        appState.emergencyActive = false;
        elements.sirenOverlay.classList.remove('active');
        logEvent('system', 'Emergency cleared. Smart controllers returning signals to regular cycle.');
    }

    // --- Event listener bindings ---

    // Toggle AI mode checkbox
    elements.aiToggle.addEventListener('change', (e) => {
        appState.aiControllerActive = e.target.checked;
        if (appState.aiControllerActive) {
            elements.badgeMode.innerText = 'AI OPTIMIZED';
            elements.badgeMode.className = 'badge mode-badge';
            logEvent('ai', 'Dynamic timing optimization active. Smart feedback loops engaged.');
        } else {
            elements.badgeMode.innerText = 'FIXED CYCLE';
            elements.badgeMode.className = 'badge mode-badge fixed';
            logEvent('system', 'Signal timing forced to Fixed Mode (15s cycles). AI optimizations paused.');
        }
    });

    // Toggle CV overlay
    elements.cvToggle.addEventListener('change', (e) => {
        appState.cvOverlayEnabled = e.target.checked;
        logEvent('system', `Computer Vision overlay ${appState.cvOverlayEnabled ? 'ENABLED' : 'DISABLED'}.`);
    });

    // Sensitivity adjustment
    elements.sensitivitySlider.addEventListener('input', (e) => {
        appState.sensitivity = parseInt(e.target.value);
        elements.sensitivityVal.innerText = `${appState.sensitivity}%`;
    });

    // Reset stats
    elements.resetStatsBtn.addEventListener('click', () => {
        appState.stats.totalVehicles = 0;
        appState.stats.waitTimeSaved = 28.4;
        logEvent('system', 'Stats registry cleared. Cumulative dashboard parameters zeroed.');
    });

    // Interactive button triggers
    elements.triggerEmergencyBtn.addEventListener('click', () => {
        const lanesList = ['N', 'E', 'S', 'W'];
        const chosenLane = lanesList[Math.floor(Math.random() * lanesList.length)];
        triggerEmergencyMode(chosenLane, true);
    });

    elements.clearEmergencyBtn.addEventListener('click', () => {
        if (!appState.emergencyActive) return;
        
        // Clear emergency state and stop sound
        disableEmergencyMode();
        
        // Clear all emergency vehicles from simulator
        vehiclesList = vehiclesList.filter(v => v.type !== 'emergency');
        
        logEvent('system', 'Emergency override manually cancelled. Simulated ambulances cleared.');
    });

    elements.triggerCongestionBtn.addEventListener('click', () => {
        logEvent('system', 'Spawn Congestion Spike event triggered. Spawning massive influx of vehicles.');
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                const dirs = ['N', 'S', 'E', 'W'];
                spawnVehicle(dirs[Math.floor(Math.random() * dirs.length)]);
            }, i * 200);
        }
    });

    // Fullscreen API implementation
    const videoContainer = document.getElementById('video-container');
    const fullscreenBtn = document.getElementById('fullscreen-btn');

    if (fullscreenBtn && videoContainer) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                videoContainer.requestFullscreen().catch(err => {
                    logEvent('system', `Error enabling fullscreen mode: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement === videoContainer) {
                fullscreenBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>
                    </svg>
                    Exit Fullscreen
                `;
                logEvent('system', 'Monitor entering fullscreen presentation layout.');
            } else {
                fullscreenBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                    </svg>
                    Fullscreen
                `;
                logEvent('system', 'Monitor exiting fullscreen mode.');
            }
        });
    }

    // --- Feed Tab Toggling & Video Handling ---
    elements.tabSim.addEventListener('click', () => {
        appState.activeFeed = 'sim';
        elements.tabSim.classList.add('active');
        elements.tabSim.style.background = 'rgba(0, 245, 160, 0.1)';
        elements.tabSim.style.borderColor = 'var(--accent)';
        elements.tabSim.style.color = 'var(--accent)';

        elements.tabVideo.classList.remove('active');
        elements.tabVideo.style.background = 'rgba(255,255,255,0.02)';
        elements.tabVideo.style.borderColor = 'var(--border-color)';
        elements.tabVideo.style.color = 'var(--text-muted)';

        elements.videoControlBar.style.display = 'none';
        elements.videoCumulativeRow.style.display = 'none';
        elements.monitorVideo.pause();
        logEvent('system', 'Switched display to 2D Intersection Simulator.');
    });

    elements.tabVideo.addEventListener('click', () => {
        appState.activeFeed = 'video';
        elements.tabVideo.classList.add('active');
        elements.tabVideo.style.background = 'rgba(0, 245, 160, 0.1)';
        elements.tabVideo.style.borderColor = 'var(--accent)';
        elements.tabVideo.style.color = 'var(--accent)';

        elements.tabSim.classList.remove('active');
        elements.tabSim.style.background = 'rgba(255,255,255,0.02)';
        elements.tabSim.style.borderColor = 'var(--border-color)';
        elements.tabSim.style.color = 'var(--text-muted)';

        elements.videoControlBar.style.display = 'flex';
        elements.videoCumulativeRow.style.display = 'flex';
        
        // If a video is already loaded, resume play
        if (elements.monitorVideo.src) {
            elements.monitorVideo.play().catch(err => console.log('Video play deferred:', err));
        }
        logEvent('system', 'Switched display to Live Video Analytics Mode.');
    });

    // Sample video feeds urls
    const sampleFeedAUrl = 'https://assets.mixkit.co/videos/preview/mixkit-traffic-in-a-large-avenue-of-a-city-43183-large.mp4';
    const sampleFeedBUrl = 'https://assets.mixkit.co/videos/preview/mixkit-intersection-of-a-city-with-a-lot-of-traffic-43187-large.mp4';

    elements.btnFeedA.addEventListener('click', () => {
        elements.videoStatus.innerText = 'Loading Sample Feed A...';
        
        // Reset cumulative video counts
        cumulativeVideoCount = 0;
        nextVehicleId = 1;
        trackedVehicles = [];
        elements.videoCumulativeCount.innerText = '0';

        elements.monitorVideo.src = sampleFeedAUrl;
        elements.monitorVideo.play()
            .then(() => {
                elements.videoStatus.innerText = 'Playing: Sample Feed A';
                logEvent('iot-hub', 'Running real-time CV differencing on Feed A...');
            })
            .catch(err => {
                elements.videoStatus.innerText = 'Failed to load video';
                console.error(err);
            });
    });

    elements.btnFeedB.addEventListener('click', () => {
        elements.videoStatus.innerText = 'Loading Sample Feed B...';
        
        // Reset cumulative video counts
        cumulativeVideoCount = 0;
        nextVehicleId = 1;
        trackedVehicles = [];
        elements.videoCumulativeCount.innerText = '0';

        elements.monitorVideo.src = sampleFeedBUrl;
        elements.monitorVideo.play()
            .then(() => {
                elements.videoStatus.innerText = 'Playing: Sample Feed B';
                logEvent('iot-hub', 'Running real-time CV differencing on Feed B...');
            })
            .catch(err => {
                elements.videoStatus.innerText = 'Failed to load video';
                console.error(err);
            });
    });

    // File input changes
    elements.videoFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            elements.videoStatus.innerText = `Loading: ${file.name}...`;
            
            // Reset cumulative video counts
            cumulativeVideoCount = 0;
            nextVehicleId = 1;
            trackedVehicles = [];
            elements.videoCumulativeCount.innerText = '0';

            const fileURL = URL.createObjectURL(file);
            elements.monitorVideo.src = fileURL;
            elements.monitorVideo.play()
                .then(() => {
                    elements.videoStatus.innerText = `Playing Local Video: ${file.name}`;
                    logEvent('system', `User loaded custom video file: ${file.name}. Commencing frame differencing.`);
                })
                .catch(err => {
                    elements.videoStatus.innerText = 'Failed to play uploaded video';
                    console.error(err);
                });
        }
    });

    // --- Metric Updates Cron/Timers ---
    setInterval(() => {
        // Compute dynamically Wait time saved telemetry values
        if (appState.aiControllerActive) {
            appState.stats.waitTimeSaved = Math.min(48.5, parseFloat((25 + Math.sin(Date.now() / 10000) * 8 + (signalController.aiOptimizationCount % 10) * 1.5).toFixed(1)));
        } else {
            appState.stats.waitTimeSaved = 0;
        }

        // Push values to line graph trend data arrays
        const currentCongestion = appState.stats.congestionIndex;
        
        // Cycle updates
        const cycleNS = ((signalController.activePhase === 'N' || signalController.activePhase === 'S') && signalController.state === 'green') 
            ? Math.ceil(signalController.timeLeft) 
            : 15;
        const cycleEW = ((signalController.activePhase === 'E' || signalController.activePhase === 'W') && signalController.state === 'green') 
            ? Math.ceil(signalController.timeLeft) 
            : 15;

        updateCharts(currentCongestion, cycleNS, cycleEW);
    }, 1000);

    // Initialize layout and launch loop
    initCharts();
    drawIntersectionLayout();
    
    // Spawn initial simulation vehicles
    for (let i = 0; i < 5; i++) {
        const dirs = ['N', 'S', 'E', 'W'];
        spawnVehicle(dirs[i % 4]);
    }
    
    // Start main frame animation loop
    requestAnimationFrame(runSimulationLoop);
});
