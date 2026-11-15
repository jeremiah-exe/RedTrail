# RedTrail — Mars Exploration & Route Planning

**An interactive terrain-aware mapping and route-planning application for the Jezero Crater region of Mars.**

RedTrail is a project developed for the NASA Space Apps Challenge. It provides an interactive Mars map designed to support astronaut exploration and mission-route planning using real planetary surface data.

## Overview

RedTrail aims to help explorers understand the terrain before travelling across the Martian surface.

Rather than relying exclusively on the shortest route, RedTrail provides terrain-aware route-planning capabilities so users can compare alternative paths and make informed decisions.

## Features

- **Interactive Mars Map:** Explore the Jezero Crater region using a high-resolution CTX orthomosaic.
- **Geographic Navigation:** Pan, zoom and inspect locations using the project's custom Mars map projection.
- **Terrain Analysis:** Utilise elevation data to understand changes in the Martian landscape.
- **Route Planning:** Calculate and compare alternative routes between selected locations.
- **Terrain-Aware Routing:** Consider terrain characteristics when evaluating possible paths.
- **Route Comparison:** Compare route distances, terrain characteristics and estimated travel requirements.
- **Mission Support:** Provide explorers with additional information to support route-selection decisions.

## Technology Stack

| Technology | Purpose |
|---|---|
| JavaScript | Application logic |
| Vite | Development server and build tooling |
| OpenLayers | Interactive mapping |
| GeoTIFF | Geospatial raster data processing |
| Proj4 | Custom coordinate projections |

## Getting Started

### Option 1: Download the project

1. Visit the [RedTrail GitHub repository](https://github.com/jeremiah-exe/RedTrail).
2. Click the green **Code** button.
3. Select **Download ZIP**.
4. Extract the downloaded ZIP file.
5. Follow the installation instructions below.

### Option 2: Clone using Git

Open a terminal and run:

```bash
git clone https://github.com/jeremiah-exe/RedTrail.git
cd RedTrail
```

### Requirements

To run the development version locally, you need:

- Node.js 20.19+ or 22.12+
- npm (included with Node.js)
- A modern web browser

Download Node.js from:

https://nodejs.org/

### Installation

Open a terminal inside the project directory and execute:

```bash
npm ci
```

This installs the dependencies specified in the package-lock file.

### Run the application

Start the local development server:

```bash
npm run dev
```

Vite will provide a local URL, usually:

```text
http://localhost:5173
```

Open this URL in your browser to access RedTrail.

## Production Build

To generate an optimised production build:

```bash
npm run build
```

The generated application will be available in the `dist` directory.

To preview the production build locally:

```bash
npm run preview
```

## Running Without Node.js

The GitHub repository currently contains the application source code.

Downloading the source ZIP alone does not produce a ready-to-run application. A prebuilt hosted version or packaged executable is needed for users who do not have Node.js installed.

A hosted version can be accessed directly through a web browser without installing development tools.

**Hosted application:** To be added.

## Scientific Data

RedTrail uses planetary surface data to support its mapping and terrain-analysis capabilities.

The project focuses on the Jezero Crater region of Mars.

Dataset names, original data sources, processing details and scientific references should be documented here.

## Project Purpose

RedTrail is designed to support informed exploration of the Martian surface by making geospatial information and terrain-aware route planning accessible through an interactive interface.

It is a mission-planning support tool and should not be interpreted as an autonomous guarantee of route safety.

## Development Team

Developed as a team project for the NASA Space Apps Challenge.

**Repository:** https://github.com/jeremiah-exe/RedTrail

---

*RedTrail — Explore Mars with terrain awareness.*
