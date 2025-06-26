let score = 0;
const namedCities = new Set(); // Set to track cities that have already been named
let settlementLocations = []; // Array to store settlement data
let markers = []; // Array to store markers for easy removal

// Get the score div element globally so it can be accessed when updating the score
const scoreDiv = document.getElementById("score");

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/bright",
  center: [0, 0], // Default center is [0, 0]
  zoom: 3, // Default zoom level
});


map.on('load', function() {
  map.setLayoutProperty('label_city', 'visibility', 'none');
  map.setLayoutProperty('label_city_capital', 'visibility', 'none');

});

// Function to center the map on the user's location
const centerMapOnUserLocation = (position) => {
  const userCoords = [position.coords.longitude, position.coords.latitude];
  map.setCenter(userCoords);
  map.setZoom(10); // Zoom in a little when user's location is found
};

// Function to handle the case where geolocation is not allowed
const handleGeoLocationError = () => {
  console.log(
    "User denied geolocation or geolocation is unavailable. Using default location."
  );
};

// Try to get the user's location
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    centerMapOnUserLocation,
    handleGeoLocationError
  );
} else {
  console.log("Geolocation is not supported by this browser.");
  handleGeoLocationError();
}

// Function to show the "Searching..." message
const showSearchingMessage = () => {
  const messageDiv = document.createElement("div");
  messageDiv.id = "searching-message";
  messageDiv.style.position = "absolute";
  messageDiv.style.top = "50%";
  messageDiv.style.left = "50%";
  messageDiv.style.transform = "translate(-50%, -50%)";
  messageDiv.style.padding = "10px";
  messageDiv.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  messageDiv.style.color = "white";
  messageDiv.style.fontSize = "18px";
  messageDiv.textContent = "Searching ...";
  document.getElementById("map").appendChild(messageDiv);
};

// Function to remove the "Searching..." message
const removeSearchingMessage = () => {
  const messageDiv = document.getElementById("searching-message");
  if (messageDiv) {
    messageDiv.remove();
  }
};

// Function to fetch settlements and display them on the map
const fetchSettlementsOnClick = (event) => {
  const lng = event.lngLat.lng;
  const lat = event.lngLat.lat;

  showSearchingMessage();

  const query = `[out:json][timeout:25];
    (
      node["place"~"city"](${lat - 1.0},${lng - 1.0},${lat + 1.0},${lng + 1.0});
    );
    out body;
    >;
    out skel qt 25;`;

  fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to fetch data from Overpass API");
      }
      return response.json();
    })
    .then((data) => {
      settlementLocations = data.elements
        .filter((element) => element.tags && element.tags.name)
        .map((element) => ({
          name: element.tags.name,
          coordinates: [element.lon, element.lat],
        }))
        .slice(0, 12);

      console.log("Settlements:", settlementLocations);

      const citiesDiv = document.getElementById("cities");
      citiesDiv.innerHTML = "";
      const bounds = new maplibregl.LngLatBounds();

      settlementLocations.forEach((settlement, index) => {
        const cityElement = document.createElement("div");
        citiesDiv.style.display = "flex";
        citiesDiv.style.flexWrap = "wrap";
        citiesDiv.style.gap = "5px";
        cityElement.className = "draggable";
        cityElement.textContent = settlement.name;
        cityElement.draggable = true;
        cityElement.dataset.index = index;
        cityElement.style.display = "inline-block";
        cityElement.style.padding = "5px";
        cityElement.style.margin = "5px 0";
        cityElement.style.background = "#ddd";
        cityElement.style.cursor = "grab";
        cityElement.style.border = "1px solid #ccc";
        cityElement.style.whiteSpace = "nowrap";
        citiesDiv.appendChild(cityElement);

        const markerElement = document.createElement("div");
        markerElement.style.backgroundColor = "white";
        markerElement.style.width = "10px";
        markerElement.style.height = "10px";
        markerElement.style.borderRadius = "50%";
        markerElement.style.border = "2px solid red";

        const marker = new maplibregl.Marker(markerElement)
          .setLngLat(settlement.coordinates)
          .addTo(map);

        markers.push({ name: settlement.name, marker });

        bounds.extend(settlement.coordinates);
      });

      map.fitBounds(bounds, { padding: 20 });

      const scoreDiv = document.getElementById("score");
      if (scoreDiv) {
        scoreDiv.textContent =
          "Drag each city name to its correct position on the map.";
      }

      removeSearchingMessage();
      map.off("click", fetchSettlementsOnClick);

      enableDragAndSnap();
    })
    .catch((error) => {
      console.error("Error fetching Overpass data:", error);
      removeSearchingMessage();
    });
};

const enableDragAndSnap = () => {
  const draggableItems = document.querySelectorAll(".draggable");

  draggableItems.forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", e.target.dataset.index);
    });
  });

  const mapCanvas = map.getCanvas();

  // Define `handleDragOver`
  const handleDragOver = (e) => {
    e.preventDefault(); // Allow drop
  };

  // Define `handleDrop`
  const handleDrop = (e) => {
    e.preventDefault();

    const droppedIndex = e.dataTransfer.getData("text/plain");
    const settlement = settlementLocations[droppedIndex];

    const { x, y } = e;
    const rect = mapCanvas.getBoundingClientRect();
    const lngLat = map.unproject([x - rect.left, y - rect.top]);

    let closestMarker = null;
    let minDistance = Infinity;

    settlementLocations.forEach((location) => {
      const distance = Math.sqrt(
        Math.pow(location.coordinates[0] - lngLat.lng, 2) +
        Math.pow(location.coordinates[1] - lngLat.lat, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestMarker = location;
      }
    });

    const markerLngLat = new maplibregl.LngLat(
      closestMarker.coordinates[0],
      closestMarker.coordinates[1]
    );

    if (settlement.name === closestMarker.name) {
      // Correct match
      score++;
      if (score === settlementLocations.length) {
        scoreDiv.textContent = `Well done! You found all ${settlementLocations.length} cities!`;
      } else {
        scoreDiv.textContent = `${score} / ${settlementLocations.length} cities named`;
      }

      // Remove any existing mismatch marker (if it exists)
      markers.forEach((markerObj) => {
        if (markerObj.name === settlement.name && markerObj.marker.remove) {
          markerObj.marker.remove();
        }
      });

      // Add a correct placement marker (green)
      const labelElement = document.createElement("div");
      labelElement.textContent = settlement.name;
      labelElement.style.fontSize = "14px";
      labelElement.style.color = "black";
      labelElement.style.padding = "2px 5px";
      labelElement.style.borderRadius = "3px";
      labelElement.style.whiteSpace = "nowrap";

      const labelMarker = new maplibregl.Marker(labelElement)
        .setLngLat(markerLngLat)
        .addTo(map);

      // Store labelMarker for future reference (if needed)
      markers.push({ name: settlement.name, marker: labelMarker });

      console.log(`Label added for ${settlement.name}`);
    } else {
      // Mismatch case
      console.log(`${settlement.name} dropped but did not match ${closestMarker.name}`);

      // Create the mismatch marker element (a simple round div)
      const mismatchMarkerElement = document.createElement("div");
      mismatchMarkerElement.style.width = "10px";
      mismatchMarkerElement.style.height = "10px";
      mismatchMarkerElement.style.borderRadius = "50%";
      mismatchMarkerElement.style.border = "2px solid red";
      mismatchMarkerElement.style.backgroundColor = "white";
      mismatchMarkerElement.style.position = "relative";  // Important for positioning the label inside the marker
      mismatchMarkerElement.style.zIndex = "100";  // Add a z-index to control the stacking order

      // Create the label element
      const mismatchLabelElement = document.createElement("div");
      mismatchLabelElement.textContent = settlement.name;
      mismatchLabelElement.style.fontSize = "12px";
      mismatchLabelElement.style.color = "black";
      mismatchLabelElement.style.backgroundColor = "white";
      mismatchLabelElement.style.padding = "2px 5px";
      mismatchLabelElement.style.border = "2px solid red";
      mismatchLabelElement.style.borderRadius = "3px";
      mismatchLabelElement.style.whiteSpace = "nowrap";
      mismatchLabelElement.style.textAlign = "center";  // Center the text inside the label

      // To center the label inside the marker element:
      mismatchLabelElement.style.position = "absolute";
      mismatchLabelElement.style.left = "50%";
      mismatchLabelElement.style.top = "50%";
      mismatchLabelElement.style.transform = "translate(-50%, -50%)";  // Offset to center the label

      // Append the label inside the marker element
      mismatchMarkerElement.appendChild(mismatchLabelElement);

      // Create the mismatch marker using the custom element
      const mismatchMarker = new maplibregl.Marker(mismatchMarkerElement)
        .setLngLat(markerLngLat)
        .setOffset([0, 0])  // Apply the offset to the marker itself
        .setDraggable(true)    // Make only the mismatch marker draggable
        .addTo(map);

      // Store the mismatch marker for future reference (if needed)
      markers.push({ name: settlement.name, marker: mismatchMarker });

      console.log(`${settlement.name} dropped but did not match ${closestMarker.name}`);

mismatchMarker.on("dragend", (e) => {
  const newLngLat = e.target.getLngLat();
  let closestMatch = null;
  let closestDist = Infinity;

  // Check the distance between the dragged marker and other settlements
  settlementLocations.forEach((location) => {
    const dist = Math.sqrt(
      Math.pow(location.coordinates[0] - newLngLat.lng, 2) +
      Math.pow(location.coordinates[1] - newLngLat.lat, 2)
    );
    if (dist < closestDist) {
      closestDist = dist;
      closestMatch = location;
    }
  });

  if (closestMatch) {
    // Snap the mismatch marker to the closest settlement
    mismatchMarker.setLngLat([closestMatch.coordinates[0], closestMatch.coordinates[1]]);
    console.log(`Mismatch marker snapped to ${closestMatch.name}`);

    // Check if the snapped marker matches the settlement name
    const distLng = Math.abs(closestMatch.coordinates[0] - mismatchMarker.getLngLat().lng);
    const distLat = Math.abs(closestMatch.coordinates[1] - mismatchMarker.getLngLat().lat);
    
    const distanceThreshold = 0.0001; // Tolerance for floating-point comparison
    if (distLng < distanceThreshold && distLat < distanceThreshold) {
      console.log("Marker matches the closest settlement!");

      // Only proceed with removing the mismatch marker if the name matches
      if (closestMatch.name === settlement.name) {
        // Remove the mismatch marker
        mismatchMarker.remove();
        console.log("Mismatch marker removed");

        // Remove the closest marker (the round white marker with the red border)
        markers.forEach((markerObj, index) => {
          if (markerObj.name === closestMatch.name) {
            console.log("Removing closest marker:", markerObj);
            markerObj.marker.remove(); // Remove the closest marker from the map
            markers.splice(index, 1);  // Remove it from the markers array
          }
        });

        // Add the correct label marker
        const labelElement = document.createElement("div");
        labelElement.textContent = closestMatch.name;  // Correct settlement name
        labelElement.style.fontSize = "14px";
        labelElement.style.color = "black";
        labelElement.style.padding = "2px 5px";
        labelElement.style.borderRadius = "3px";
        labelElement.style.whiteSpace = "nowrap";

        const labelMarker = new maplibregl.Marker(labelElement)
          .setLngLat(new maplibregl.LngLat(closestMatch.coordinates[0], closestMatch.coordinates[1]))
          .addTo(map);

        // Store labelMarker for future reference
        markers.push({ name: closestMatch.name, marker: labelMarker });

        // Update score
        score++;
      if (score === settlementLocations.length) {
        scoreDiv.textContent = `Well done! You found all ${settlementLocations.length} cities!`;
      } else {
        scoreDiv.textContent = `${score} / ${settlementLocations.length} cities named`;
      }

      } else {
        console.log("Mismatch marker placed incorrectly, will not remove or add any new markers.");
      }
    } else {
      console.log("Mismatch marker placed incorrectly, will not remove it.");
    }
  }
});


    }

   // Remove the city from the cities div once placed
    const cityElement = document.querySelector(`[data-index='${droppedIndex}']`);
    if (cityElement) {
      cityElement.remove();
    }
    
  };

  // Remove existing handlers to avoid duplicate events
  mapCanvas.removeEventListener("dragover", handleDragOver);
  mapCanvas.removeEventListener("drop", handleDrop);

  // Attach handlers
  mapCanvas.addEventListener("dragover", handleDragOver);
  mapCanvas.addEventListener("drop", handleDrop);
};

// Attach the click event to the map
map.on("click", fetchSettlementsOnClick);