import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1Ijoiaml5MDk5IiwiYSI6ImNtN2xpeXJlZzAzd3gya3EwNTU4Z29sczcifQ.7rY3IfhfBUnfsrR11yxHqA';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

let stations = [];
let trips = [];
let circles;
let radiusScale;

function formatTime(minutes) {
    const date = new Date(0, 0, 0, Math.floor(minutes / 60), minutes % 60);
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // HH:MM AM/PM
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id
    );

    return stations.map((station) => {
        let id = String(station.short_name).trim();
        station.arrivals = arrivals.get(id) || 0;
        station.departures = departures.get(id) || 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips
        : trips.filter((trip) => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

let stationFlow = d3.scaleQuantize()
.domain([0, 1])
.range([0, 0.5, 1]);

map.on('load', async () => {

    const bikeLaneStyle = {
        'line-color': '#32D400',
        'line-width': 4,
        'line-opacity': 0.6
    };

    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: bikeLaneStyle
    });


    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: bikeLaneStyle
    });


    let jsonData;
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        jsonData = await d3.json(jsonurl);
    } catch (error) {
        console.error('Error loading JSON:', error);
        return;
    }

    stations = jsonData.data.stations;

    const svg = d3.select('#map').select('svg');

    function getCoords(station) {
        if (!station.lon || !station.lat) {
            console.error("Invalid station coordinates:", station);
            return { cx: 0, cy: 0 };
        }
    
        const point = new mapboxgl.LngLat(+station.lon, +station.lat);
        const { x, y } = map.project(point);
        return { cx: x, cy: y };
    }

    try {
        const csvurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
        trips = await d3.csv(csvurl, (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
        });
    } catch (error) {
        console.error('Error loading CSV:', error);
        return;
    }

    stations = computeStationTraffic(stations, trips);

    radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic || 0)])
        .range([3, 25]);

    circles = svg.selectAll('circle')
        .data(stations, d => d.short_name)
        .enter()
        .append('circle')
        .attr('r', d => radiusScale(d.totalTraffic || 0))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8);


    circles.append('title')
        .text(d => {
            if (d.totalTraffic !== undefined) {
                return `Station ${d.name || d.short_name}: ${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
            } else {
                return `Station ${d.name || d.short_name}: No traffic data available`;
            }
        });

    function updatePositions() {
        circles
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy)
            .attr('r', d => radiusScale(d.totalTraffic || 0))
            .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic || 0));
    }
    

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    
    function updateTimeDisplay() {
        let timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
            selectedTime.textContent = '';
            anyTimeLabel.style.display = 'block';
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = 'none';
        }

        updateScatterPlot(timeFilter);
    }
    
    
    function updateScatterPlot(timeFilter) {
        const filteredTrips = filterTripsbyTime(trips, timeFilter);
    
        const filteredStations = computeStationTraffic(stations, filteredTrips);
    
        if (timeFilter === -1) {
            radiusScale.range([0, 25]);
        } else {
            radiusScale.range([3, 50]);
        }
    
        circles
            .data(filteredStations, (d) => d.short_name)
            .join('circle')
            .attr('r', (d) => radiusScale(d.totalTraffic || 0))
            .style('--departure-ratio', (d) => {
                let ratio = stationFlow(d.departures / d.totalTraffic || 0);
                return ratio;
            });
    }
    
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    updateTimeDisplay();
});
