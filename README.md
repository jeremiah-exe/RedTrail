# RedTrail — Mars Exploration & Route Planning

**Explore Mars with terrain awareness.**

RedTrail is an interactive terrain-aware mapping and route-planning application designed for the Jezero Crater region of Mars. Developed for the NASA Space Apps Challenge, it uses planetary surface data to help explorers understand Martian terrain and make informed mission-planning decisions.

## Overview

Exploring the Martian surface presents unique challenges. Terrain conditions, elevation changes and geographical obstacles can influence the feasibility of a planned journey.

RedTrail aims to address these challenges by providing an interactive Mars map and terrain-aware route-planning capabilities.

Rather than relying exclusively on the shortest route, RedTrail allows users to compare alternative paths, examine terrain characteristics and make informed decisions about potential exploration routes.

## Features

- **Interactive Mars Map:** Explore the Jezero Crater region using high-resolution CTX orthomosaic imagery.
- **Geographic Navigation:** Pan, zoom and inspect locations using a custom Mars map projection.
- **Terrain Analysis:** Utilise elevation data to understand changes in the Martian landscape.
- **Route Planning:** Calculate routes between selected locations.
- **Terrain-Aware Routing:** Consider terrain characteristics when evaluating possible paths.
- **Route Comparison:** Compare alternative routes based on distance, terrain characteristics and estimated travel requirements.
- **Mission Support:** Provide explorers with additional information to support informed route-selection decisions.

## Technology Stack

| Technology | Purpose |
|---|---|
| JavaScript | Application logic |
| Vite | Development server and build tooling |
| OpenLayers | Interactive mapping |
| GeoTIFF | Geospatial raster data processing |
| Proj4 | Custom coordinate projections |

## Getting Started

Follow the instructions below to download and run RedTrail locally.

### Requirements

Make sure you have the following installed:

- Git
- Git LFS (Git Large File Storage)
- Node.js 20.19+ or 22.12+
- npm (included with Node.js)
- A modern web browser

Download the required tools:

- [Git](https://git-scm.com/downloads)
- [Git LFS](https://git-lfs.com/)
- [Node.js](https://nodejs.org/)

### Step 1: Configure Git LFS

After installing Git LFS, open a terminal and run:

```bash
git lfs install
```

This enables Git LFS on your computer.

### Step 2: Clone the Repository

Clone the RedTrail repository:

```bash
git clone https://github.com/jeremiah-exe/RedTrail.git
cd RedTrail
```

Git LFS automatically downloads the large planetary datasets during cloning when properly installed and configured.

If the datasets have not downloaded automatically, run:

```bash
git lfs pull
```

### Step 3: Install Dependencies

Inside the RedTrail project directory, execute:

```bash
npm ci
```

This installs all the dependencies specified in the project's package-lock file.

### Step 4: Start RedTrail

Start the local development server:

```bash
npm run dev
```

Vite will provide a local URL, usually:

```text
http://localhost:5173
```

Open this URL in your browser to start exploring the Jezero Crater region.

## Production Build

To generate an optimised production build, execute:

```bash
npm run build
```

The generated application will be available in the `dist` directory.

To preview the production build locally:

```bash
npm run preview
```

## Scientific Data

RedTrail uses planetary surface datasets covering the Jezero Crater region of Mars.

The application incorporates:

- **CTX Orthomosaic:** High-resolution imagery from the Mars Reconnaissance Orbiter's Context Camera (CTX).
- **Digital Elevation Model (DEM):** Elevation information used for terrain analysis and terrain-aware route planning.
- **Cloud Optimized GeoTIFFs (COGs):** Geospatial raster formats used to store and access planetary datasets efficiently.

These datasets are integrated into the application to support interactive mapping, terrain analysis and route planning.

Original dataset sources, processing methods and relevant scientific references should be credited alongside the corresponding datasets.

## Important Notes

- RedTrail uses Git LFS to store large planetary raster datasets.
- Git LFS must be installed before cloning the repository.
- A stable internet connection is required to download the planetary datasets.
- The application requires the COG files to be available in their expected project directories.
- Downloading the source ZIP directly from GitHub does not automatically provide the actual Git LFS datasets. Cloning with Git LFS is the recommended installation method.

## Troubleshooting

### Map or Terrain Data Not Loading

If the application opens but planetary datasets are missing, run:

```bash
git lfs install
git lfs pull
```

Ensure that all required COG files have downloaded completely into `public/data`.

### Build Errors

Check that you have a compatible Node.js version installed:

```bash
node --version
npm --version
```

Then reinstall dependencies:

```bash
npm ci
npm run build
```

If problems persist, check the browser developer console for missing resources or runtime errors.

## Project Purpose

RedTrail is designed to support informed exploration of the Martian surface by making geospatial information and terrain-aware route planning accessible through an interactive interface.

It is a mission-planning support tool and should not be interpreted as an autonomous guarantee of route safety. Route recommendations are intended to assist human decision-making.

## Development Team

Developed as a team project for the **NASA Space Apps Challenge**.

**GitHub Repository:** https://github.com/jeremiah-exe/RedTrail

---

*RedTrail — Explore Mars with terrain awareness.*
