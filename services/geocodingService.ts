/**
 * Geocoding Service using Nominatim (OpenStreetMap)
 * Free API - No API key required
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 */

export interface GeoLocation {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
}

export interface GeoResult {
  label: string; // "City, Region, Country"
  city: string;
  region: string;
  country: string;
  lat: string;
  lng: string;
}

/**
 * Search for cities by name using Nominatim API
 * @param query - City name to search
 * @returns Array of matching locations
 */
export async function searchCities(query: string): Promise<GeoResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  try {
    // Use Nominatim API with city/town filtering
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');
    url.searchParams.set('featuretype', 'city'); // Prioritize cities

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'PictoNet/1.0 (Accessibility Tool)', // Required by Nominatim
      },
    });

    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }

    const data: GeoLocation[] = await response.json();

    // Transform results to our format
    return data
      .filter(item => {
        // Only include results that have city-like information
        const hasCity = item.address?.city || item.address?.town || item.address?.village;
        return hasCity;
      })
      .map(item => {
        const city = item.address?.city || item.address?.town || item.address?.village || '';
        const region = item.address?.state || '';
        const country = item.address?.country || '';

        // Build label: "City, Region, Country"
        const labelParts = [city, region, country].filter(Boolean);
        const label = labelParts.join(', ');

        return {
          label,
          city,
          region,
          country,
          lat: item.lat,
          lng: item.lon,
        };
      })
      .slice(0, 8); // Limit to 8 results
  } catch (error) {
    console.error('Geocoding error:', error);
    return [];
  }
}

/**
 * Reverse geocode: Get location info from coordinates
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Location information
 */
export async function reverseGeocode(lat: string, lng: string): Promise<GeoResult | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', lat);
    url.searchParams.set('lon', lng);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'PictoNet/1.0 (Accessibility Tool)',
      },
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding error: ${response.status}`);
    }

    const data: GeoLocation = await response.json();

    const city = data.address?.city || data.address?.town || data.address?.village || '';
    const region = data.address?.state || '';
    const country = data.address?.country || '';

    const labelParts = [city, region, country].filter(Boolean);
    const label = labelParts.join(', ');

    return {
      label,
      city,
      region,
      country,
      lat: data.lat,
      lng: data.lon,
    };
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
}
