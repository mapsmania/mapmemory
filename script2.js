/**
 * MapMemoryGame - An interactive geography learning game where players place city names on a map
 */

const MapMemoryGame = {
    config: {
        mapStyle: "https://tiles.openfreemap.org/styles/bright",  
        initialZoom: 3,                
        initialCenter: [0, 0],         
        snapDistance: 50,              // Distance in pixels for marker snapping
        showDebug: false,              

        // Endpoints array for reliable failover matching
        overpassEndpoints: [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass.openstreetmap.ru/api/interpreter',
            'https://overpass.nchc.org.tw/api/interpreter'
        ],

        searchRadii: [25000, 50000, 100000, 200000],  
        minSettlements: 6,             
        maxSettlements: 12,            
        populationThresholds: {        
            city: 50000,
            town: 10000,
            village: 5000
        },
        mapBoundsPadding: 50,        
        maxZoomLevel: 10,            
        zoomOutTolerance: 1.5,        
        zoomSettleDelay: 2000        
    },

    state: {
        score: 0,                    
        settlements: [],             
        markers: [],                 
        currentMouseLngLat: null,    
        gameStarted: false,          
        numberOfMoves: 0,            
        labelLayers: []              
    },

    elements: {
        map: null,                   
        scoreDiv: null,              
        citiesDiv: null,             
        debugDiv: null               
    },

    touchState: {
        isDragging: false,           
        currentDrag: null,           
        touchStartX: 0,              
        touchStartY: 0,              
        dragThreshold: 5,            
        dragStarted: false  
    },

    isMobileDevice() {
        return window.innerWidth <= 768;
    },

    init() {
        this.elements.scoreDiv = document.getElementById("score");
        this.elements.citiesDiv = document.getElementById("cities");

        this.initMap();
        this.initDebugDisplay();
        this.initGeolocation();

        this.elements.map.on('click', (e) => {
            if (!this.state.gameStarted) {
                this.handleGameStart(e.lngLat);
            }
        });

        this.elements.map.on('mousemove', (e) => {
            if (!this.state.gameStarted) {
                this.elements.map.getCanvas().style.cursor = 'pointer';
            }
        });
    },

    async handleGameStart(clickLngLat) {
        if (this.state.gameStarted) return;

        this.elements.map.setCenter(clickLngLat);
        this.showLoadingMessage();
        const citiesFound = await this.fetchNearbySettlements(clickLngLat);

        if (citiesFound) {
            const header = document.querySelector('.game-header');
            if (header) header.style.display = 'none';

            const scoreDiv = this.elements.scoreDiv;
            scoreDiv.textContent = `0 / ${this.state.settlements.length} cities named`;
            scoreDiv.style.display = "inline";

            this.setupDragAndDrop();
            this.state.gameStarted = true;
            this.elements.map.getCanvas().style.cursor = '';
        } else {
            this.resetGameUI();
        }
    },

    resetGameUI() {
        this.hideLoadingMessage();

        const header = document.querySelector('.game-header');
        if (header) header.style.display = 'block';
        if (this.elements.scoreDiv) this.elements.scoreDiv.style.display = 'none';
        if (this.elements.citiesDiv) this.elements.citiesDiv.innerHTML = '';

        this.state.gameStarted = false;
        this.state.score = 0;
        this.state.settlements = [];
        this.state.numberOfMoves = 0;

        this.state.markers.forEach(marker => {
            if (marker.marker) marker.marker.remove();
        });
        this.state.markers = [];
        this.elements.map.getCanvas().style.cursor = 'pointer';
    },

    initMap() {
        this.elements.map = new maplibregl.Map({
            container: "map",
            style: this.config.mapStyle,
            center: this.config.initialCenter,
            zoom: this.config.initialZoom,
            attributionControl: false
        });

        this.elements.map.addControl(new maplibregl.FullscreenControl({ container: document.body }), 'top-left');
        this.elements.map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-left');

        this.elements.map.on('load', () => {
            const style = this.elements.map.getStyle();
            const labelLayers = style.layers.filter(layer =>
                layer.id.toLowerCase().includes('label') ||
                layer.id.toLowerCase().includes('text') ||
                layer.id.toLowerCase().includes('place') ||
                layer.id.toLowerCase().includes('name')
            );

            this.state.labelLayers = labelLayers.map(layer => layer.id);
            this.state.labelLayers.forEach(layerId => {
                this.elements.map.setLayoutProperty(layerId, 'visibility', 'none');
            });

            this.attachMapEventListeners();
        });
    },

    initGeolocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const userCoords = [position.coords.longitude, position.coords.latitude];
                    this.elements.map.setCenter(userCoords);
                    this.elements.map.setZoom(10);
                },
                () => { console.log("Geolocation denied or unavailable. Using default location."); }
            );
        }
    },

    initDebugDisplay() {
        if (!this.config.showDebug) return;
        this.elements.debugDiv = document.createElement("div");
        this.elements.debugDiv.id = "mouse-debug";
        Object.assign(this.elements.debugDiv.style, {
            position: "absolute", bottom: "10px", left: "10px",
            backgroundColor: "rgba(255, 255, 255, 0.8)", padding: "5px",
            borderRadius: "3px", fontSize: "12px", zIndex: "1000"
        });
        document.getElementById("map-container").appendChild(this.elements.debugDiv);
    },

    attachMapEventListeners() {
        this.elements.map.on('mousemove', this.handleMouseMove.bind(this));
    },

    handleMouseMove(e) {
        this.state.currentMouseLngLat = e.lngLat;
        if (this.config.showDebug && this.elements.debugDiv) {
            const point = this.elements.map.project(e.lngLat);
            this.elements.debugDiv.textContent = `
                Mouse: ${e.lngLat.lng.toFixed(6)}, ${e.lngLat.lat.toFixed(6)}
                Screen: ${point.x.toFixed(0)}px, ${point.y.toFixed(0)}px
            `;
        }
    },

    async fetchNearbySettlements(center) {
        let allSettlements = new Map();
        let attempts = 0;
        let lastRadius = 0;

        for (const radius of this.config.searchRadii) {
            attempts++;
            this.showLoadingMessage(attempts > 1, radius);

            try {
                const effectiveRadius = radius; // Look over standard boundary ranges cleanly
                const newSettlements = await this.fetchSettlementsWithRadius(
                    center.lat, center.lng, effectiveRadius, attempts
                );

                if (newSettlements && newSettlements.length > 0) {
                    newSettlements.forEach(settlement => {
                        if(settlement.tags && settlement.tags.name) {
                            const name = settlement.tags.name;
                            if (!allSettlements.has(name)) {
                                allSettlements.set(name, settlement);
                            }
                        }
                    });
                }

                if (allSettlements.size >= this.config.maxSettlements) break;

                if (allSettlements.size >= this.config.minSettlements) {
                    this.showSearchingMessage(`Found ${allSettlements.size} cities, searching for more...`);
                }
                lastRadius = radius;
            } catch (error) {
                console.error(`Error in search attempt ${attempts}:`, error);
                continue; 
            }
        }

        if (allSettlements.size >= this.config.minSettlements) {
            this.processSearchResults(Array.from(allSettlements.values()));
            return true;
        } else {
            this.showNoSettlementsMessage();
            return false;
        }
    },

    showSearchingMessage(message) {
        const messageEl = document.getElementById("loading-message");
        if (messageEl) messageEl.textContent = message;
    },

    async fetchSettlementsWithRadius(lat, lon, radius, attempt) {
        const query = `
            [out:json][timeout:25];
            (
                node["place"="city"](around:${radius},${lat},${lon});
                node["place"="town"](around:${radius},${lat},${lon});
                node["place"="village"](around:${radius},${lat},${lon});
            );
            out body;
            >;
        `;

        // Sequential fallback implementation fixed across dynamic target endpoints
        for (let url of this.config.overpassEndpoints) {
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 12000);
                const response = await fetch(`${url}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
                clearTimeout(id);
                if (response.ok) {
                    const data = await response.json();
                    return data.elements;
                }
            } catch (e) {
                console.warn(`Instance failed at ${url}, falling back...`);
            }
        }
        throw new Error("All Overpass servers failed.");
    },

    processSearchResults(settlements) {
        const uniqueSettlements = new Map();

        settlements
            .filter(element => element.tags && element.tags.name && element.lat && element.lon && element.tags.place)
            .forEach(element => {
                const name = element.tags.name;
                if (!uniqueSettlements.has(name)) {
                    uniqueSettlements.set(name, {
                        name: name,
                        coordinates: [element.lon, element.lat],
                        population: this.getPopulation(element.tags),
                        type: element.tags.place,
                        importance: this.calculateImportance(element.tags)
                    });
                }
            });

        this.state.settlements = Array.from(uniqueSettlements.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, this.config.maxSettlements);

        const bounds = new maplibregl.LngLatBounds();
        this.state.settlements.forEach(s => bounds.extend(s.coordinates));

        this.elements.map.fitBounds(bounds, {
            padding: this.config.mapBoundsPadding,
            maxZoom: this.config.maxZoomLevel
        });

        this.elements.map.once('moveend', () => {
            setTimeout(() => {
                const fittedZoom = this.elements.map.getZoom();
                this.elements.map.setMinZoom(fittedZoom - this.config.zoomOutTolerance);
            }, this.config.zoomSettleDelay);
        });

        this.hideLoadingMessage();
        this.displayCities();
        this.createMarkers();
    },

    getPopulation(tags) {
        const populationValue = tags.population || tags.inhabitants || '0';
        return parseInt(populationValue.replace(/[^0-9]/g, '')) || 0;
    },

    calculateImportance(tags) {
        let importance = 0;
        const placeWeights = { city: 100, town: 50, village: 25 };
        importance += placeWeights[tags.place] || 0;
        const population = this.getPopulation(tags);
        importance += Math.log10(population + 1) * 10;
        if (tags.capital) importance += 200;
        if (tags.admin_level) importance += (8 - parseInt(tags.admin_level)) * 10;
        return importance;
    },

    showLoadingMessage(isExpanded = false, currentRadius = null) {
        let message = document.getElementById("loading-message");
        if (!message) {
            message = document.createElement("div");
            message.id = "loading-message";
            message.style.cssText = `
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                padding: 10px; background-color: rgba(0, 0, 0, 0.7); color: white;
                font-size: 18px; border-radius: 5px; zIndex: 1000;
            `;
            document.getElementById("map").appendChild(message);
        }
        let text = "Searching...";
        if (isExpanded && currentRadius) {
            text = `Expanding search to ${Math.round(currentRadius / 1000)}km radius...`;
        }
        message.textContent = text;
    },

    showNoSettlementsMessage() {
        const message = document.createElement("div");
        message.id = "no-settlements-message";
        message.style.cssText = `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background-color: white; padding: 10px; border-radius: 5px; border: 1px solid #ccc; zIndex: 1000;
        `;
        message.textContent = "No cities found in this area. Click another spot!";
        const legacy = document.getElementById("no-settlements-message");
        if (legacy) legacy.remove();

        document.getElementById("map").appendChild(message);
        setTimeout(() => { if (message) message.remove(); }, 3000);
    },

    hideLoadingMessage() {
        const message = document.getElementById("loading-message");
        if (message) message.remove();
    },

    displayCities() {
        this.elements.citiesDiv.innerHTML = "";
        this.elements.citiesDiv.style.cssText = "display: flex; flex-wrap: wrap; gap: 5px;";

        this.state.settlements.forEach((settlement, index) => {
            const cityElement = document.createElement("div");
            cityElement.className = "draggable";
            cityElement.draggable = true;
            cityElement.textContent = settlement.name;
            cityElement.dataset.index = index;
            Object.assign(cityElement.style, {
                padding: "5px", margin: "5px 0", background: "#ddd",
                cursor: "grab", border: "1px solid #ccc", borderRadius: "3px", whiteSpace: "nowrap"
            });
            this.elements.citiesDiv.appendChild(cityElement);
        });
        this.setupDraggableItems();
    },

    createMarkers() {
        const isMobile = this.isMobileDevice();
        const markerSize = isMobile ? this.config.markerSizeMobile : this.config.markerSize;
        const borderWidth = isMobile ? this.config.markerBorderMobile : this.config.markerBorder;

        this.state.settlements.forEach(settlement => {
            const markerElement = document.createElement("div");
            markerElement.style.cssText = `
                width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%;
                border: ${borderWidth}px solid red; background-color: white;
                pointer-events: none; transform: translate(-50%, -50%);
            `;

            const marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
                .setLngLat(settlement.coordinates)
                .addTo(this.elements.map);

            this.state.markers.push({ name: settlement.name, marker });
        });
    },

    setupDragAndDrop() {
        const mapCanvas = this.elements.map.getCanvas();
        mapCanvas.removeEventListener("dragover", this.handleDragOver);
        mapCanvas.removeEventListener("drop", this.handleDrop);
        mapCanvas.addEventListener("dragover", this.handleDragOver);
        mapCanvas.addEventListener("drop", this.handleDrop.bind(this));
        this.setupDraggableItems();
    },

    setupDraggableItems() {
        const draggableItems = document.querySelectorAll(".draggable");
        draggableItems.forEach(item => {
            const index = item.dataset.index;
            item.addEventListener("touchstart", (e) => this.handleTouchStart(e, index), { passive: false });
            item.addEventListener("touchmove", (e) => this.handleTouchMove(e), { passive: false });
            item.addEventListener("touchend", (e) => this.handleTouchEnd(e), { passive: false });
            item.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", index); });
        });
    },

    handleDragOver(e) {
        e.preventDefault();
    },

    handleDrop(e) {
        e.preventDefault();
        const index = e.dataTransfer.getData("text/plain");
        this.processPlacement(index, [e.clientX, e.clientY]);
    },

    handleTouchStart(e, index) {
        e.preventDefault();
        const touch = e.touches[0];
        const item = e.target;
        const rect = item.getBoundingClientRect();

        const existingClone = document.getElementById('drag-clone');
        if (existingClone) existingClone.remove();

        this.touchState = {
            isDragging: true, currentDrag: item, touchStartX: touch.clientX, touchStartY: touch.clientY,
            offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top, index: index
        };

        const clone = item.cloneNode(true);
        clone.id = 'drag-clone';
        Object.assign(clone.style, {
            position: 'fixed', zIndex: '1000', opacity: '0.8', pointerEvents: 'none',
            width: `${item.offsetWidth}px`, height: `${item.offsetHeight}px`,
            left: `${touch.clientX - this.touchState.offsetX}px`, top: `${touch.clientY - this.touchState.offsetY}px`
        });

        document.body.appendChild(clone);
        this.touchState.clone = clone;
        item.style.opacity = '0.4';
    },

    handleTouchMove(e) {
        e.preventDefault();
        if (!this.touchState.isDragging) return;
        const touch = e.touches[0];
        const clone = this.touchState.clone;
        if (clone) {
            clone.style.left = `${touch.clientX - this.touchState.offsetX}px`;
            clone.style.top = `${touch.clientY - this.touchState.offsetY}px`;
        }
    },

    handleTouchEnd(e) {
        e.preventDefault();
        if (!this.touchState.isDragging) return;

        const touch = e.changedTouches[0];
        this.processPlacement(this.touchState.index, [touch.clientX, touch.clientY]);
        this.cleanupDragState();
    },

    cleanupDragState() {
        if (this.touchState.clone) this.touchState.clone.remove();
        if (this.touchState.currentDrag) this.touchState.currentDrag.style.opacity = '';
        this.touchState = { isDragging: false, currentDrag: null, touchStartX: 0, touchStartY: 0, dragStarted: false };
    },

    // Unified placement calculation handler for shared Drag or Touch drops
    processPlacement(index, screenCoords) {
        const settlement = this.state.settlements[index];
        if (!settlement) return;

        const mapCanvas = this.elements.map.getCanvas();
        const mapRect = mapCanvas.getBoundingClientRect();
        
        const x = screenCoords[0] - mapRect.left;
        const y = screenCoords[1] - mapRect.top;

        let nearestSettlement = null;
        let shortestDistance = Infinity;

        this.state.settlements.forEach(s => {
            const point1 = { x, y };
            const point2 = this.elements.map.project(s.coordinates);
            const distance = Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));

            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestSettlement = s;
            }
        });

        if (nearestSettlement && nearestSettlement.name === settlement.name && shortestDistance <= this.config.snapDistance) {
            this.state.score++;
            this.elements.scoreDiv.textContent = `${this.state.score} / ${this.state.settlements.length} cities named`;

            // Clean up red dot
            this.state.markers = this.state.markers.filter(m => {
                if (m.name === settlement.name) {
                    m.marker.remove();
                    return false;
                }
                return true;
            });

            // Append persistent Green Text Marker node
            const label = document.createElement("div");
            label.textContent = settlement.name;
            label.style.cssText = "font-size: 13px; color: green; font-weight: bold; background: white; padding: 2px 4px; border-radius: 3px; white-space: nowrap;";
            
            const successMarker = new maplibregl.Marker({ element: label })
                .setLngLat(settlement.coordinates)
                .addTo(this.elements.map);

            this.state.markers.push({ name: settlement.name + "_correct_label", marker: successMarker });

            // Remove placed name block element from sidebar menu options
            const el = document.querySelector(`[data-index='${index}']`);
            if (el) el.remove();

            if (this.state.score === this.state.settlements.length) {
                this.elements.scoreDiv.textContent = `Well done! You found all ${this.state.settlements.length} cities!`;
            }
        }
    }
};
