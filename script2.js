/**
 * MapMemoryGame - An interactive geography learning game where players place city names on a map
 * 
 * Features:
 * - Dynamic city/settlement fetching based on map view
 * - Drag and drop functionality for both desktop and mobile
 * - Responsive design with mobile-specific optimizations
 * - Progressive difficulty with expanding search radius
 * - Score tracking and game completion handling
 */

const MapMemoryGame = {
    /**
     * Configuration settings for the game
     * Contains all customizable parameters and thresholds
     */
    config: {
        mapStyle: "https://tiles.openfreemap.org/styles/bright",  // Base map style URL
        initialZoom: 3,                // Starting zoom level
        initialCenter: [0, 0],         // Starting center coordinates
        snapDistance: 50,              // Distance in pixels for marker snapping
        showDebug: false,              // Debug mode toggle

        // Search configuration for finding settlements
        searchRadii: [25000, 50000, 100000, 200000],  // Progressive search radii in meters
        minSettlements: 6,             // Minimum settlements required to start game
        maxSettlements: 12,            // Maximum settlements to display
        populationThresholds: {        // Population thresholds for settlement types
            city: 50000,
            town: 10000,
            village: 5000
        },
        minZoomLevel: 6,              // Minimum zoom level for settlement search
        zoomOutTolerance: 1.5,        // Allowed zoom levels below fitted zoom
        zoomSettleDelay: 2000,        // Delay before setting zoom restriction (ms)

        // Marker styling configuration
        markerSize: 14,               // Desktop marker size (px)
        markerSizeMobile: 10,         // Mobile marker size (px)
        markerBorder: 2,              // Desktop border width (px)
        markerBorderMobile: 1,        // Mobile border width (px)
        markerBorderCorrect: 4,       // Border width for correct placement
        markerBorderCorrectMobile: 2, // Mobile border width for correct placement

        // Label styling configuration
        labelPadding: '2px 4px',
        labelFontSize: 13,           // Base font size (px)
        labelFontSizeMobile: 13,     // Mobile font size (px)

        // Label offset configuration
        correctLabelOffset: 8,
        correctLabelOffsetMobile: 8,
        incorrectLabelOffset: 8,
        incorrectLabelOffsetMobile: 4,

        // Map configuration
        mapBoundsPadding: 50,        // Padding for map bounds fitting
        maxZoomLevel: 10,            // Maximum allowed zoom level

        labelTypes: {
            GAME: 'game',            // Game-generated labels
            MAP: 'map'               // Base map labels
        }
    },

    /**
     * Game state management
     * Tracks current game progress and data
     */
    state: {
        score: 0,                    // Current score
        settlements: [],             // Array of settlements in play
        markers: [],                 // Array of map markers
        currentMouseLngLat: null,    // Current mouse position
        gameStarted: false,          // Game state flag
        numberOfMoves: 0,            // Total moves counter
        labelLayers: []              // Map label layers
    },

    /**
     * DOM element references
     * Stores references to key UI elements
     */
    elements: {
        map: null,                   // MapLibre map instance
        scoreDiv: null,              // Score display element
        citiesDiv: null,             // Cities list container
        debugDiv: null               // Debug information display
    },

    /**
     * Touch interaction state
     * Manages touch-based interactions
     */
    touchState: {
        isDragging: false,           // Touch drag state
        currentDrag: null,           // Currently dragged element
        touchStartX: 0,              // Initial touch X coordinate
        touchStartY: 0,              // Initial touch Y coordinate
        dragThreshold: 5,            // Minimum pixels for drag
        dragStarted: false           // Drag initiation flag
    },

    /**
     * Checks if the current device is mobile
     * @returns {boolean} True if device is mobile, false otherwise
     */
    isMobileDevice()
    {
        return window.innerWidth <= 768;
    },

    /**
     * Initializes the game
     * Sets up initial state and event listeners
     */
    init()
    {
        this.elements.scoreDiv = document.getElementById("score");
        this.elements.citiesDiv = document.getElementById("cities");

        this.initMap();
        this.initDebugDisplay();
        this.initGeolocation();

        // Add click handler to start game
        this.elements.map.on('click', (e) =>
        {
            if (!this.state.gameStarted)
            {
                this.handleGameStart(e.lngLat);
            }
        });

        // Add hover effect when game hasn't started
        this.elements.map.on('mousemove', (e) =>
        {
            if (!this.state.gameStarted)
            {
                this.elements.map.getCanvas().style.cursor = 'pointer';
            }
        });
    },

    /**
     * Handles game start event
     * Initiates settlement fetching and sets up the game
     */
    async handleGameStart(clickLngLat)
    {
        if (this.state.gameStarted) return;

        // Center map on clicked location
        this.elements.map.setCenter(clickLngLat);

        this.showLoadingMessage();
        const citiesFound = await this.fetchNearbySettlements(clickLngLat);

        if (citiesFound)
        {
            // Hide the game header and show the game UI
            document.querySelector('.game-header').style.display = 'none';

            // Update score display
            const scoreDiv = this.elements.scoreDiv;
            scoreDiv.textContent = `0 / ${this.state.settlements.length} cities named`;
            scoreDiv.style.display = "inline";

            this.setupDragAndDrop();
            this.state.gameStarted = true;

            // Remove pointer cursor
            this.elements.map.getCanvas().style.cursor = '';
        } else
        {
            // Reset UI to initial state if no cities found
            this.resetGameUI();
        }
    },

    /**
     * Resets the game UI to initial state
     * Cleans up messages and restores starting view
     * @param { boolean } showStartButton - Whether to show the start button(default: true)
     */
    resetGameUI()
    {
        // Clear any existing loading message
        this.hideLoadingMessage();

        // Reset the sidebar to initial state
        document.querySelector('.game-header').style.display = 'block';
        this.elements.scoreDiv.style.display = 'none';
        this.elements.citiesDiv.innerHTML = '';

        // Reset game state
        this.state.gameStarted = false;
        this.state.score = 0;
        this.state.settlements = [];
        this.state.numberOfMoves = 0;

        // Clear any existing markers
        this.state.markers.forEach(marker =>
        {
            if (marker.marker)
            {
                marker.marker.remove();
            }
        });
        this.state.markers = [];

        // Reset cursor to pointer since game can be started again
        this.elements.map.getCanvas().style.cursor = 'pointer';
    },

    /**
     * Initializes the map component
     * Sets up the MapLibre instance and its controls
     */
    

    initMap()
    {
        this.elements.map = new maplibregl.Map({
            container: "map",
            style: this.config.mapStyle,
            center: this.config.initialCenter,
            zoom: this.config.initialZoom,
            attributionControl: false
        });

        // Add fullscreen control
        this.elements.map.addControl(new maplibregl.FullscreenControl({
            container: document.body
        }), 'top-left');

        // Add navigation controls
        this.elements.map.addControl(new maplibregl.NavigationControl({
            showCompass: false,
            visualizePitch: false
        }), 'bottom-left');

        this.elements.map.on('load', () =>
        {
            // Find and hide all label layers
            const style = this.elements.map.getStyle();
            const labelLayers = style.layers.filter(layer =>
                layer.id.toLowerCase().includes('label') ||
                layer.id.toLowerCase().includes('text') ||
                layer.id.toLowerCase().includes('place') ||
                layer.id.toLowerCase().includes('name')
            );

            this.state.labelLayers = labelLayers.map(layer => layer.id);

            // Hide all label layers
            this.state.labelLayers.forEach(layerId =>
            {
                this.elements.map.setLayoutProperty(layerId, 'visibility', 'none');
            });

            this.attachMapEventListeners();

        });
    },

    /**
     * Initializes geolocation functionality
     * Attempts to center the map on user's location
     */
    initGeolocation()
    {
        if (navigator.geolocation)
        {
            navigator.geolocation.getCurrentPosition(
                // Success callback
                (position) =>
                {
                    const userCoords = [position.coords.longitude, position.coords.latitude];
                    this.elements.map.setCenter(userCoords);
                    this.elements.map.setZoom(10);
                },
                // Error callback
                () =>
                {
                    console.log("Geolocation denied or unavailable. Using default location.");
                }
            );
        }
    },

    /**
     * Initializes debug display if enabled
     * Creates and configures debug information panel
     */
    initDebugDisplay()
    {
        if (!this.config.showDebug) return;

        this.elements.debugDiv = document.createElement("div");
        this.elements.debugDiv.id = "mouse-debug";
        Object.assign(this.elements.debugDiv.style, {
            position: "absolute",
            bottom: "10px",
            left: "10px",
            backgroundColor: "rgba(255, 255, 255, 0.8)",
            padding: "5px",
            borderRadius: "3px",
            fontSize: "12px",
            zIndex: "1000"
        });
        document.getElementById("map-container").appendChild(this.elements.debugDiv);
    },

    /**
     * Attaches map event listeners
     * Sets up mouse movement tracking
     */
    attachMapEventListeners()
    {
        this.elements.map.on('mousemove', this.handleMouseMove.bind(this));
    },

    /**
     * Handles mouse movement events
     * Updates current mouse position and debug display
     * @param {Event} e - Mouse event object
     */
    handleMouseMove(e)
    {
        this.state.currentMouseLngLat = e.lngLat;

        if (this.config.showDebug && this.elements.debugDiv)
        {
            const point = this.elements.map.project(e.lngLat);
            this.elements.debugDiv.textContent = `
                Mouse: ${e.lngLat.lng.toFixed(6)}, ${e.lngLat.lat.toFixed(6)}
                Screen: ${point.x.toFixed(0)}px, ${point.y.toFixed(0)}px
            `;
        }
    },

    /**
     * Fetches nearby settlements from OpenStreetMap
     * Uses progressive search radii to find sufficient settlements
     * @returns {Promise<boolean>} Success status of settlement fetch
     */
    async fetchNearbySettlements(center)
    {
        let allSettlements = new Map();
        let attempts = 0;
        let lastRadius = 0;

        for (const radius of this.config.searchRadii)
        {
            attempts++;
            this.showLoadingMessage(attempts > 1, radius);

            try
            {
                // Only search the additional area beyond the last radius
                const effectiveRadius = radius - lastRadius;
                const newSettlements = await this.fetchSettlementsWithRadius(
                    center.lat,
                    center.lng,
                    effectiveRadius,
                    attempts
                );

                if (newSettlements && newSettlements.length > 0)
                {
                    newSettlements.forEach(settlement =>
                    {
                        const name = settlement.tags.name;
                        if (!allSettlements.has(name))
                        {
                            allSettlements.set(name, settlement);
                        }
                    });
                }

                // Check if we've reached our target
                if (allSettlements.size >= this.config.maxSettlements)
                {
                    break;
                }

                // If we have minimum settlements but not maximum, keep searching but update UI
                if (allSettlements.size >= this.config.minSettlements)
                {
                    const foundCount = allSettlements.size;
                    this.showSearchingMessage(
                        `Found ${foundCount} cities, searching for more...`
                    );
                }

                lastRadius = radius;

            } catch (error)
            {
                console.error(`Error in search attempt ${attempts}:`, error);
                // Continue to next radius even if this one failed
                continue;
            }
        }

        // Process results if we have at least minimum settlements
        if (allSettlements.size >= this.config.minSettlements)
        {
            this.processSearchResults(Array.from(allSettlements.values()));
            return true;
        } else
        {
            this.showNoSettlementsMessage();
            return false;
        }
    },

    /**
     * Shows status message during extended search
     * @param {string} message - Message to display
     */
    showSearchingMessage(message)
    {
        const messageEl = document.getElementById("loading-message");
        if (messageEl)
        {
            messageEl.textContent = message;
        }
    },

    /**
     * Fetches settlements within a specific radius
     * @param {number} lat - Latitude of center point
     * @param {number} lon - Longitude of center point
     * @param {number} radius - Search radius in meters
     * @param {number} attempt - Current attempt number
     * @returns {Promise<Array>} Array of settlement data
     */
    /**
     * Fetches settlements within a specific radius with automatic server fallbacks
     * @param {number} lat - Latitude of center point
     * @param {number} lon - Longitude of center point
     * @param {number} radius - Search radius in meters
     * @param {number} attempt - Current attempt number
     * @returns {Promise<Array>} Array of settlement data
     */
    async fetchSettlementsWithRadius(lat, lon, radius, attempt)
    {
        const { populationThresholds } = this.config;

        const cityThreshold = populationThresholds.city / Math.pow(2, attempt - 1);
        const townThreshold = populationThresholds.town / Math.pow(2, attempt - 1);

        // List of reliable public Overpass instances to fallback on
        const OVERPASS_ENDPOINTS = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass.openstreetmap.ru/api/interpreter',
            'https://overpass.nchc.org.tw/api/interpreter'
        ];

        const query = `
            [out:json][timeout:25];
            (
                node["place"="city"][~"^(population|inhabitants)$"~"."](around:${radius},${lat},${lon});
                node["place"="town"][~"^(population|inhabitants)$"~"."](around:${radius},${lat},${lon});
                node["place"="village"][~"^(population|inhabitants)$"~"."](around:${radius},${lat},${lon});
            );
            out body;
            >;
        `;

        // Sequentially loop through servers until one successfully resolves
        for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
            const baseUrl = OVERPASS_ENDPOINTS[i];
            
            try {
                // Setup an AbortController so hanging instances don't block the game loop indefinitely
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout per attempt

                const response = await fetch(
                    `${baseUrl}?data=${encodeURIComponent(query)}`,
                    { signal: controller.signal }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`MapMemoryGame: Overpass instance ${baseUrl} failed with status ${response.status}. Trying fallback...`);
                    continue; 
                }

                const data = await response.json();
                return data.elements; // Return elements and exit method on success!

            } catch (error) {
                console.warn(`MapMemoryGame: Network/timeout error with Overpass instance ${baseUrl}:`, error.message);
                // Continue to the next instance in the array loop
            }
        }

        // If the loop runs to completion without a return statement, all endpoints failed
        throw new Error("All public Overpass API endpoints failed to resolve this search region.");
    },
  
    /**
     * Processes search results and prepares game state
     * @param {Array} settlements - Array of raw settlement data
     */
    processSearchResults(settlements)
    {
        const uniqueSettlements = new Map();

        settlements
            .filter(element =>
                element.tags &&
                element.tags.name &&
                element.lat &&
                element.lon &&
                element.tags.place
            )
            .forEach(element =>
            {
                const name = element.tags.name;
                if (!uniqueSettlements.has(name))
                {
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
        this.state.settlements.forEach(settlement =>
        {
            bounds.extend(settlement.coordinates);
        });

        this.elements.map.fitBounds(bounds, {
            padding: this.config.mapBoundsPadding,
            maxZoom: this.config.maxZoomLevel
        });

        this.elements.map.once('moveend', () =>
        {
            setTimeout(() =>
            {
                const fittedZoom = this.elements.map.getZoom();
                this.elements.map.setMinZoom(fittedZoom - this.config.zoomOutTolerance);
            }, this.config.zoomSettleDelay);
        });

        this.hideLoadingMessage();
        this.displayCities();
        this.createMarkers();
    },

    /**
     * Extracts population from settlement tags
     * @param {Object} tags - Settlement tags object
     * @returns {number} Population value
     */
    getPopulation(tags)
    {
        const populationValue = tags.population || tags.inhabitants || '0';
        return parseInt(populationValue.replace(/[^0-9]/g, '')) || 0;
    },

    /**
         * Calculates importance score for settlement ranking
         * @param {Object} tags - Settlement tags object
         * @returns {number} Importance score
         */
    calculateImportance(tags)
    {
        let importance = 0;
        const placeWeights = { city: 100, town: 50, village: 25 };

        importance += placeWeights[tags.place] || 0;
        const population = this.getPopulation(tags);
        importance += Math.log10(population + 1) * 10;

        if (tags.capital) importance += 200;
        if (tags.admin_level) importance += (8 - parseInt(tags.admin_level)) * 10;

        return importance;
    },

    /**
     * Displays loading message during settlement fetch
     * @param {boolean} isExpanded - Whether to show expanded message for additional searches
     */
    showLoadingMessage(isExpanded = false, currentRadius = null)
    {
        const message = document.getElementById("loading-message") || document.createElement("div");
        message.id = "loading-message";
        message.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            font-size: 18px;
            border-radius: 5px;
            z-index: 1000;
        `;

        let text = "Searching...";
        if (isExpanded && currentRadius)
        {
            const radiusKm = Math.round(currentRadius / 1000);
            text = `Expanding search to ${radiusKm}km radius...`;
        }

        message.textContent = text;

        if (!document.getElementById("loading-message"))
        {
            document.getElementById("map").appendChild(message);
        }
    },

    /**
     * Shows message when no settlements are found
     * Displays temporary notification with instructions
     */
    showNoSettlementsMessage()
    {
        const message = document.createElement("div");
        message.id = "no-settlements-message";
        message.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: white;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #ccc;
            z-index: 1000;
        `;
        message.textContent = "No cities found in this area. Try zooming out or panning to a different location.";

        const existingMessage = document.getElementById("no-settlements-message");
        if (existingMessage)
        {
            existingMessage.remove();
        }

        document.getElementById("map").appendChild(message);

        setTimeout(() =>
        {
            const msg = document.getElementById("no-settlements-message");
            if (msg)
            {
                msg.remove();
            }
        }, 3000);
    },

    /**
     * Removes loading message from display
     */
    hideLoadingMessage()
    {
        const message = document.getElementById("loading-message");
        if (message)
        {
            message.remove();
        }
    },

    /**
     * Displays city names in the sidebar for dragging
     * Creates draggable elements for each city
     */
    displayCities()
    {
        this.elements.citiesDiv.innerHTML = "";
        this.elements.citiesDiv.style.cssText = "display: flex; flex-wrap: wrap; gap: 5px;";

        this.state.settlements.forEach((settlement, index) =>
        {
            const cityElement = document.createElement("div");
            cityElement.className = "draggable";
            cityElement.draggable = true;
            cityElement.textContent = settlement.name;
            cityElement.dataset.index = index;

            Object.assign(cityElement.style, {
                padding: "5px",
                margin: "5px 0",
                background: "#ddd",
                cursor: "grab",
                border: "1px solid #ccc",
                borderRadius: "3px",
                whiteSpace: "nowrap"
            });

            this.elements.citiesDiv.appendChild(cityElement);
        });

        this.setupDraggableItems();
    },

    /**
     * Creates markers for all settlements on the map
     * Handles both mobile and desktop marker styling
     */
    createMarkers()
    {
        const bounds = new maplibregl.LngLatBounds();
        const isMobile = this.isMobileDevice();

        const markerSize = isMobile ? this.config.markerSizeMobile : this.config.markerSize;
        const borderWidth = isMobile ? this.config.markerBorderMobile : this.config.markerBorder;

        this.state.settlements.forEach(settlement =>
        {
            const markerElement = document.createElement("div");
            markerElement.style.cssText = `
                width: ${markerSize}px;
                height: ${markerSize}px;
                border-radius: 50%;
                border: ${borderWidth}px solid red;
                background-color: white;
                pointer-events: none;
                transform: translate(-50%, -50%);
            `;

            const marker = new maplibregl.Marker({
                element: markerElement,
                anchor: 'center',
                draggable: false
            })
                .setLngLat(settlement.coordinates)
                .addTo(this.elements.map);

            this.state.markers.push({
                name: settlement.name,
                marker
            });

            bounds.extend(settlement.coordinates);
        });

        this.elements.map.fitBounds(bounds, {
            padding: this.config.mapBoundsPadding,
            maxZoom: this.config.maxZoomLevel
        });
    },

    /**
     * Creates a basic marker element
     * @returns {HTMLElement} Configured marker element
     */
    createMarkerElement()
    {
        const element = document.createElement("div");
        Object.assign(element.style, {
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            border: "2px solid red",
            backgroundColor: "white",
            transform: "translate(-50%, -50%)"
        });
        return element;
    },

    /**
     * Sets up drag and drop functionality
     * Initializes both touch and mouse event handlers
     */
    setupDragAndDrop()
    {
        const mapCanvas = this.elements.map.getCanvas();

        mapCanvas.removeEventListener("dragover", this.handleDragOver);
        mapCanvas.removeEventListener("drop", this.handleDrop.bind(this));

        mapCanvas.addEventListener("dragover", this.handleDragOver);
        mapCanvas.addEventListener("drop", this.handleDrop.bind(this));

        this.setupDraggableItems();
    },

    /**
     * Sets up individual draggable items
     * Configures touch and drag event listeners for city elements
     */
    setupDraggableItems()
    {
        const draggableItems = document.querySelectorAll(".draggable");

        draggableItems.forEach(item =>
        {
            item.removeEventListener("dragstart", this.handleDragStart);
            item.removeEventListener("touchstart", this.handleTouchStart);
            item.removeEventListener("touchmove", this.handleTouchMove);
            item.removeEventListener("touchend", this.handleTouchEnd);

            const index = item.dataset.index;

            item.addEventListener("touchstart", (e) => this.handleTouchStart(e, index), { passive: false });
            item.addEventListener("touchmove", (e) => this.handleTouchMove(e), { passive: false });
            item.addEventListener("touchend", (e) => this.handleTouchEnd(e), { passive: false });
            item.addEventListener("touchcancel", (e) => this.handleTouchCancel(e), { passive: false });

            item.addEventListener("dragstart", (e) =>
            {
                e.dataTransfer.setData("text/plain", index);
            });
        });
    },

    /**
     * Handles touch start event for draggable items
     * @param {TouchEvent} e - Touch event object
     * @param {string} index - Index of the touched item
     */
    handleTouchStart(e, index)
    {
        e.preventDefault();
        const touch = e.touches[0];
        const item = e.target;
        const rect = item.getBoundingClientRect();

        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;

        // Clean up any existing clones first
        const existingClone = document.getElementById('drag-clone');
        if (existingClone)
        {
            existingClone.remove();
        }

        this.touchState = {
            isDragging: true,
            currentDrag: item,
            touchStartX: touch.clientX,
            touchStartY: touch.clientY,
            offsetX: offsetX,
            offsetY: offsetY,
            dragStarted: false,
            index: index,
            originalStyles: {
                position: item.style.position,
                left: item.style.left,
                top: item.style.top,
                zIndex: item.style.zIndex
            }
        };

        const clone = item.cloneNode(true);
        clone.id = 'drag-clone';
        Object.assign(clone.style, {
            position: 'fixed',
            zIndex: '1000',
            opacity: '0.8',
            pointerEvents: 'none',
            width: `${item.offsetWidth}px`,
            height: `${item.offsetHeight}px`,
            transform: 'scale(1.05)',
            transition: 'transform 0.1s ease',
            left: `${touch.clientX - offsetX}px`,
            top: `${touch.clientY - offsetY}px`
        });

        document.body.appendChild(clone);
        this.touchState.clone = clone;
        item.style.opacity = '0.4';
    },


    /**
     * Handles touch move event during drag
     * @param {TouchEvent} e - Touch event object
     */
    handleTouchMove(e)
    {
        e.preventDefault();
        if (!this.touchState.isDragging) return;

        const touch = e.touches[0];
        const clone = this.touchState.clone;

        if (clone)
        {
            clone.style.left = `${touch.clientX - this.touchState.offsetX}px`;
            clone.style.top = `${touch.clientY - this.touchState.offsetY}px`;

            const mapRect = this.elements.map.getCanvas().getBoundingClientRect();
            const isOverMap = (
                touch.clientX >= mapRect.left &&
                touch.clientX <= mapRect.right &&
                touch.clientY >= mapRect.top &&
                touch.clientY <= mapRect.bottom
            );

            clone.style.backgroundColor = isOverMap ? '#e8f4f8' : '';
            this.elements.map.getCanvas().style.backgroundColor =
                isOverMap ? 'rgba(0,0,0,0.05)' : '';
        }

        if (!this.touchState.dragStarted)
        {
            this.touchState.dragStarted = true;
        }
    },

    cleanupDragState()
    {
        if (this.touchState.clone)
        {
            this.touchState.clone.remove();
        }
        if (this.touchState.currentDrag)
        {
            this.touchState.currentDrag.style.opacity = '';
        }
        this.elements.map.getCanvas().style.backgroundColor = '';

        this.touchState = {
            isDragging: false,
            currentDrag: null,
            touchStartX: 0,
            touchStartY: 0,
            dragStarted: false
        };
    },

    /**
     * Handles touch end event after dragging
     * @param {TouchEvent} e - Touch event object
     */
    handleTouchEnd(e)
    {
        e.preventDefault();
        if (!this.touchState.isDragging) return;

        const item = this.touchState.currentDrag;
        const mapCanvas = this.elements.map.getCanvas();
        const mapRect = mapCanvas.getBoundingClientRect();
        const touch = e.changedTouches[0];

        if (
            touch.clientX >= mapRect.left &&
            touch.clientX <= mapRect.right &&
            touch.clientY >= mapRect.top &&
            touch.clientY <= mapRect.bottom
        )
        {
            const x = touch.clientX - mapRect.left;
            const y = touch.clientY - mapRect.top;
            const dropLngLat = this.elements.map.unproject([x, y]);

            const settlement = this.state.settlements[this.touchState.index];
            if (settlement)
            {
                this.state.numberOfMoves++;

                // Find the nearest settlement
                let nearestSettlement = null;
                let shortestDistance = Infinity;

                this.state.settlements.forEach(s =>
                {
                    const point1 = this.elements.map.project(dropLngLat);
                    const point2 = this.elements.map.project({
                        lng: s.coordinates[0],
                        lat: s.coordinates[1]
                    });

                    const distance = Math.sqrt(
                        Math.pow(point1.x - point2.x, 2) +
                        Math.pow(point1.y - point2.y, 2)
                    );

                    if (distance < shortestDistance)
                    {
                        shortestDistance = distance;
                        nearestSettlement = s;
                    }
                });

                // Only check for snapping if the nearest settlement is the correct one
                if (nearestSettlement && nearestSettlement.name === settlement.name)
                {
                    if (shortestDistance <= this.config.snapDistance)
                    {
                        // Check if this settlement is already correctly placed
                        const existingCorrectLabel = this.state.markers.find(m =>
                            m.name === settlement.name + "_correct_label"
                        );

                        // Only handle correct placement if not already placed
                        if (!existingCorrectLabel)
                        {
                            this.handleCorrectPlacement(settlement);
                        }
                        this.removeCityFromSidebar(this.touchState.index);
                        this.cleanupDragState();
                        return;
                    }
                }

                // If we get here, either the nearest city wasn't correct or it was too far
                this.handleLabelPlacement(settlement, dropLngLat);
                this.removeCityFromSidebar(this.touchState.index);
            }
        }

        this.cleanupDragState();
    },


    /**
     * Handles touch cancel event
     * @param {TouchEvent} e - Touch event object
     */
    handleTouchCancel(e)
    {
        e.preventDefault();
        this.cleanupDragState();
    },

    /**
     * Handles drag over event
     * @param {DragEvent} e - Drag event object
     */
    handleDragOver(e)
    {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    },

    /**
    * Handles drop event for dragged items
    * @param {DragEvent} e - Drop event object
    */
    handleDrop(e)
    {
        e.preventDefault();

        const droppedIndex = e.dataTransfer.getData("text/plain");
        const index = parseInt(droppedIndex);
        if (isNaN(index) || !this.state.settlements[index])
        {
            return;
        }

        const settlement = this.state.settlements[index];
        const mapCanvas = this.elements.map.getCanvas();
        const rect = mapCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dropLngLat = this.elements.map.unproject([x, y]);

        // Find the nearest settlement
        let nearestSettlement = null;
        let shortestDistance = Infinity;

        this.state.settlements.forEach(s =>
        {
            const point1 = this.elements.map.project(dropLngLat);
            const point2 = this.elements.map.project({
                lng: s.coordinates[0],
                lat: s.coordinates[1]
            });

            const distance = Math.sqrt(
                Math.pow(point1.x - point2.x, 2) +
                Math.pow(point1.y - point2.y, 2)
            );

            if (distance < shortestDistance)
            {
                shortestDistance = distance;
                nearestSettlement = s;
            }
        });

        this.state.numberOfMoves++;

        // Only check for snapping if the nearest settlement is the correct one
        if (nearestSettlement && nearestSettlement.name === settlement.name)
        {
            if (shortestDistance <= this.config.snapDistance)
            {
                // Check if this settlement is already correctly placed
                const existingCorrectLabel = this.state.markers.find(m =>
                    m.name === settlement.name + "_correct_label"
                );

                // Only handle correct placement if not already placed
                if (!existingCorrectLabel)
                {
                    this.handleCorrectPlacement(settlement);
                }
                this.removeCityFromSidebar(index);
                return;
            }
        }

        // If we get here, either the nearest city wasn't correct or it was too far
        this.handleLabelPlacement(settlement, dropLngLat);
        this.removeCityFromSidebar(index);
    },

    /**
     * Creates and places a label for incorrectly placed cities
     * @param {Object} settlement - Settlement data object
     * @param {Object} dropLngLat - Coordinates where the label should be placed
     */
    handleLabelPlacement(settlement, dropLngLat)
    {
        const isMobile = this.isMobileDevice();
        const fontSize = isMobile ? this.config.labelFontSizeMobile : this.config.labelFontSize;

        // Create draggable label container
        const labelContainer = document.createElement("div");
        labelContainer.style.cssText = `
            display: inline-block;
            background-color: white;
            padding: ${this.config.labelPadding};
            border: 1px solid red;
            border-radius: 2px;
            cursor: grab;
            user-select: none;
            font-size: ${fontSize}px;
            white-space: nowrap;
            touch-action: none;
            min-width: 24px;
            min-height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        labelContainer.textContent = settlement.name;

        // Create marker for the draggable label
        const labelMarker = new maplibregl.Marker({
            element: labelContainer,
            anchor: 'bottom',
            offset: [0, isMobile ? 8 : 12],
            draggable: true
        })
            .setLngLat(dropLngLat)
            .addTo(this.elements.map);

        // Add event listeners for touch and mouse interactions
        let touchStartPos = null;

        // Touch events
        labelContainer.addEventListener('touchstart', (e) =>
        {
            e.preventDefault();
            const touch = e.touches[0];
            touchStartPos = { x: touch.clientX, y: touch.clientY };
            labelContainer.style.cursor = 'grabbing';
        }, { passive: false });

        labelContainer.addEventListener('touchend', () =>
        {
            touchStartPos = null;
            labelContainer.style.cursor = 'grab';
        });

        // Mouse events
        labelContainer.addEventListener('mousedown', () =>
        {
            labelContainer.style.cursor = 'grabbing';
        });

        labelContainer.addEventListener('mouseup', () =>
        {
            labelContainer.style.cursor = 'grab';
        });

        // Handle marker position checking
        labelMarker.on('dragend', (e) =>
        {
            const newLngLat = e.target.getLngLat();
            const point1 = this.elements.map.project(newLngLat);
            const point2 = this.elements.map.project({
                lng: settlement.coordinates[0],
                lat: settlement.coordinates[1]
            });

            const pixelDistance = Math.sqrt(
                Math.pow(point1.x - point2.x, 2) +
                Math.pow(point1.y - point2.y, 2)
            );

            this.state.numberOfMoves++;

            // Check if this settlement is already correctly placed
            const existingCorrectLabel = this.state.markers.find(m =>
                m.name === settlement.name + "_correct_label"
            );

            if (pixelDistance <= this.config.snapDistance && !existingCorrectLabel)
            {
                labelMarker.remove();
                this.handleCorrectPlacement(settlement);
            }
        });


        // Store the label marker reference
        this.state.markers.push({
            name: settlement.name + "_label",
            marker: labelMarker
        });
    },

    /**
     * Handles correct placement of a city
     * Updates markers and score
     * @param {Object} settlement - Settlement data object
     */
    handleCorrectPlacement(settlement)
    {
        this.state.score++;
        this.updateScoreDisplay();

        const isMobile = this.isMobileDevice();
        const borderWidth = isMobile ?
            this.config.markerBorderCorrectMobile :
            this.config.markerBorderCorrect;
        const labelOffset = isMobile ?
            this.config.correctLabelOffsetMobile :
            this.config.correctLabelOffset;

        // Update existing marker appearance
        const existingMarker = this.state.markers.find(m => m.name === settlement.name);
        if (existingMarker && existingMarker.marker)
        {
            const markerElement = existingMarker.marker.getElement();
            markerElement.style.border = `${borderWidth}px solid #00aa00`;
        }

        // Create and add correct label
        const labelElement = document.createElement("div");
        labelElement.style.cssText = `
            display: inline-block;
            background-color: transparent;
            padding: ${this.config.labelPadding};
            font-size: ${isMobile ? '10px' : this.config.labelFontSize}px;
            white-space: nowrap;
            pointer-events: none;
        `;
        labelElement.textContent = settlement.name;

        const correctLabel = new maplibregl.Marker({
            element: labelElement,
            anchor: 'bottom',
            offset: [0, -labelOffset],
            draggable: false
        })
            .setLngLat(settlement.coordinates)
            .addTo(this.elements.map);

        this.state.markers.push({
            name: settlement.name + "_correct_label",
            marker: correctLabel
        });

        if (this.state.score === this.state.settlements.length)
        {
            this.handleGameCompletion();
        }
    },

    /**
     * Updates the score display
     * Shows completion message if all cities are found
     */
    updateScoreDisplay()
    {
        const total = this.state.settlements.length;
        if (this.state.score === total)
        {
            this.elements.scoreDiv.textContent =
                `Well done! You found all ${total} cities in ${this.state.numberOfMoves} moves!`;
        } else
        {
            this.elements.scoreDiv.textContent = `${this.state.score} / ${total} cities named`;
        }
    },

    /**
     * Handles game completion
     * Creates completion UI with toggle for map labels
     */
    handleGameCompletion()
    {
        const unplacedCities = this.state.settlements.length - this.state.score;
        if (unplacedCities > 0) return;

        this.state.gameStarted = false;
        this.elements.map.setMinZoom(0);

        // Create completion UI
        const completionDiv = document.createElement('div');
        completionDiv.style.cssText = `
            padding: 10px 0;
            text-align: center;
        `;

        completionDiv.innerHTML = `
            <div style="margin-bottom: 15px;">
                Well done! You found all ${this.state.settlements.length} cities in ${this.state.numberOfMoves} moves!
            </div>
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 15px; gap: 8px;">
                <input type="checkbox" id="labelToggle" style="cursor: pointer;">
                <label for="labelToggle" style="cursor: pointer;">Show all map labels</label>
            </div>
            <button id="playAgain" style="
                background-color: #4CAF50;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                width: 100%;
                transition: background-color 0.3s">
                Play Again
            </button>
            <div style="height:8px"></div>
            <button id="moreGames" onclick="window.location.href='/'" style="
                background-color: #FF8C00;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                width: 100%;
                transition: background-color 0.3s">
                More Games at TripGeo.com ▶
            </button>
        `;

        this.elements.scoreDiv.innerHTML = '';
        this.elements.scoreDiv.appendChild(completionDiv);

        // Set up label toggle functionality
        const checkbox = document.getElementById('labelToggle');
        checkbox.addEventListener('change', (e) =>
        {
            this.toggleLabels(e.target.checked ? this.config.labelTypes.MAP : this.config.labelTypes.GAME);
        });

        this.toggleLabels(this.config.labelTypes.GAME);

        // click to play again
        document.getElementById('playAgain').addEventListener('click', () =>
        {
            window.location.reload();
        });

        // click to return to tripgeo home page
        document.getElementById('moreGames').addEventListener('click', () =>
        {
            console.log("load tripgeo");
            window.top.location.href = '/';  // Goes to home page
        });



    },

    /**
     * Removes a city from the sidebar after placement
     * @param {number} index - Index of the city to remove
     */
    removeCityFromSidebar(index)
    {
        const cityElement = document.querySelector(`[data-index='${index}']`);
        if (cityElement)
        {
            const labelText = cityElement.textContent;
            const allLabels = document.querySelectorAll('.draggable');
            allLabels.forEach(label =>
            {
                if (label.textContent === labelText)
                {
                    label.remove();
                }
            });
            cityElement.remove();
        }
    },

    /**
     * Toggles visibility of map and game labels
     * @param {string} labelType - Type of labels to show (MAP or GAME)
     */
    toggleLabels(labelType)
    {
        if (labelType === this.config.labelTypes.GAME)
        {
            // Show game labels, hide map labels
            this.state.markers.forEach(marker =>
            {
                if (marker.name.includes('_correct_label'))
                {
                    marker.marker.getElement().style.display = 'block';
                }
            });
            this.state.labelLayers.forEach(layerId =>
            {
                this.elements.map.setLayoutProperty(layerId, 'visibility', 'none');
            });
        } else
        {
            // Show map labels, hide game labels
            this.state.markers.forEach(marker =>
            {
                if (marker.name.includes('_correct_label'))
                {
                    marker.marker.getElement().style.display = 'none';
                }
            });
            this.state.labelLayers.forEach(layerId =>
            {
                this.elements.map.setLayoutProperty(layerId, 'visibility', 'visible');
            });
        }
    },

    /**
     * Shows a temporary message to the user
     * @param {string} text - Message to display
     * @param {number} duration - Duration in milliseconds (optional)
     */
    showMessage(text, duration = 3000)
    {
        console.log('showMessage called with:', text);

        // Remove any existing messages first
        const existingMessages = document.querySelectorAll('.map-message');
        existingMessages.forEach(msg => msg.remove());

        const message = document.createElement("div");
        message.classList.add('map-message');

        // Ensure the message is highly visible and properly positioned
        message.style.cssText = `
        position: absolute !important;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: rgba(255, 255, 255, 0.95);
        color: black;
        padding: 15px 25px;
        border-radius: 5px;
        border: 2px solid #666;
        font-size: 16px;
        font-weight: 500;
        z-index: 9999;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        min-width: 200px;
        pointer-events: none;
    `;

        message.textContent = text;

        // Ensure map-container has correct positioning
        const mapContainer = document.getElementById("map-container");
        if (!mapContainer)
        {
            console.error('Map container not found!');
            return;
        }

        // Verify/set map container positioning
        const containerPosition = window.getComputedStyle(mapContainer).position;
        if (containerPosition === 'static')
        {
            console.log('Setting map container to relative positioning');
            mapContainer.style.position = 'relative';
        }

        console.log('Appending message to container');
        mapContainer.appendChild(message);

        // Set up removal timer
        setTimeout(() =>
        {
            if (message && message.parentNode)
            {
                console.log('Removing message');
                message.remove();
            }
        }, duration);
    }
};


// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () =>
{
    MapMemoryGame.init();
});

/* Header Styling */
const colors = [
    '#2ecc71',  // Green
    '#e74c3c',  // Red
    '#3498db',  // Blue
    '#f1c40f',  // Yellow
    '#9b59b6',  // Purple
    '#e67e22'   // Orange
];

function createRandomCircle()
{
    const header = document.querySelector('.map-header');
    if (!header) return;

    const circle = document.createElement('div');
    circle.className = 'circle';

    const size = Math.random() * 20 + 15; // Random size between 15-35px

    circle.style.width = size + 'px';
    circle.style.height = size + 'px';

    // Position circles on the right side
    const rightMargin = 20; // Space from right edge
    circle.style.left = (header.offsetWidth - size - rightMargin - (Math.random() * 50)) + 'px';
    circle.style.top = Math.random() * (header.offsetHeight - size) + 'px';

    // Random color from our palette
    const color = colors[Math.floor(Math.random() * colors.length)];
    circle.style.borderColor = color;

    header.appendChild(circle);

    // Remove circle after animation completes
    setTimeout(() =>
    {
        circle.remove();
    }, 4000);
}

// Create new circles
setInterval(createRandomCircle, 1000);

// Create initial circles
for (let i = 0; i < 3; i++)
{
    setTimeout(createRandomCircle, Math.random() * 1000);
}
