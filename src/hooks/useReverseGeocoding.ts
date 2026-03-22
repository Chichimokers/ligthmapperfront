import { useCallback, useRef } from 'react';

export interface GeocodingResult {
  lat: number;
  lon: number;
  road?: string;
  suburb?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  displayName: string;
}

interface CacheEntry {
  result: GeocodingResult;
  timestamp: number;
}

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const RATE_LIMIT_DELAY = 1100;

const geocodingCache = new Map<string, CacheEntry>();
let lastRequestTime = 0;

const getCacheKey = (lat: number, lon: number): string => {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
};

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const formatLocationName = (data: {
  road?: string;
  suburb?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
}): { shortName: string; fullName: string } => {
  const zoneName = data.suburb || data.city_district || data.town || data.village || data.city || 'Unknown';
  
  let fullName = zoneName;
  if (data.state) {
    fullName += `, ${data.state}`;
  }
  
  return {
    shortName: zoneName,
    fullName: fullName
  };
};

export const reverseGeocode = async (lat: number, lon: number): Promise<GeocodingResult | null> => {
  const cacheKey = getCacheKey(lat, lon);
  
  const cached = geocodingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('📦 Cache hit for', cacheKey);
    return cached.result;
  }

  console.log('🌐 Making geocoding request for', lat, lon);

  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await sleep(RATE_LIMIT_DELAY - timeSinceLastRequest);
  }

  lastRequestTime = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    
    console.log('📡 Fetching:', url);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LightMapperApp/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const location = formatLocationName(data.address || {});
    
    const result: GeocodingResult = {
      lat: parseFloat(data.lat),
      lon: parseFloat(data.lon),
      road: data.address?.road,
      suburb: data.address?.suburb,
      district: data.address?.city_district,
      city: data.address?.city || data.address?.town || data.address?.village,
      state: data.address?.state,
      country: data.address?.country,
      displayName: location.fullName
    };

    console.log('✅ Geocoding result:', result.displayName);
    geocodingCache.set(cacheKey, { result, timestamp: Date.now() });
    
    return result;
  } catch (error) {
    console.error('❌ Geocoding failed:', error);
    return null;
  }
};

export const useReverseGeocoding = () => {
  const processingRef = useRef<Set<string>>(new Set());

  const getLocationName = useCallback(async (lat: number, lon: number): Promise<string> => {
    const cacheKey = getCacheKey(lat, lon);
    
    if (processingRef.current.has(cacheKey)) {
      while (processingRef.current.has(cacheKey)) {
        await sleep(100);
      }
      const cached = geocodingCache.get(cacheKey);
      return cached?.result.displayName || 'Ubicación desconocia';
    }

    const result = await reverseGeocode(lat, lon);
    
    if (result) {
      return result.displayName;
    }
    
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }, []);

  const geocodeMultiple = useCallback(async (
    locations: Array<{ lat: number; lon: number; id: number | string }>,
    onProgress?: (progress: number, total: number) => void
  ): Promise<Map<string | number, GeocodingResult>> => {
    console.log('📍 geocodeMultiple called with', locations.length, 'locations');
    const results = new Map<string | number, GeocodingResult>();
    const uniqueCoords = new Map<string, typeof locations[0]>();

    for (const loc of locations) {
      const key = getCacheKey(loc.lat, loc.lon);
      if (!uniqueCoords.has(key)) {
        uniqueCoords.set(key, loc);
      }
    }

    const uniqueLocations = Array.from(uniqueCoords.values());
    console.log('🗺️ Unique locations to geocode:', uniqueLocations.length);
    let processed = 0;

    for (const loc of uniqueLocations) {
      const key = getCacheKey(loc.lat, loc.lon);
      
      processingRef.current.add(key);
      
      const cached = geocodingCache.get(key);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        results.set(loc.id, cached.result);
      } else {
        const result = await reverseGeocode(loc.lat, loc.lon);
        if (result) {
          results.set(loc.id, result);
        }
      }
      
      processingRef.current.delete(key);
      processed++;
      onProgress?.(processed, uniqueLocations.length);
    }

    console.log('✅ geocodeMultiple complete, results:', results.size);
    return results;
  }, []);

  return {
    getLocationName,
    geocodeMultiple,
    isCacheEmpty: geocodingCache.size === 0
  };
};

export const clearGeocodingCache = () => {
  geocodingCache.clear();
};
