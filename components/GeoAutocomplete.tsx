import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2, Search } from 'lucide-react';
import { searchCities, GeoResult } from '../services/geocodingService';
import { useTranslation } from '../hooks/useTranslation';

interface GeoAutocompleteProps {
  value: {
    lat?: string;
    lng?: string;
    region?: string;
  };
  onChange: (geoContext: { lat: string; lng: string; region: string }) => void;
}

export const GeoAutocomplete: React.FC<GeoAutocompleteProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Display current location if available
  const displayValue = value.region || query;

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const cities = await searchCities(query);
        setResults(cities);
        setShowDropdown(cities.length > 0);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500); // 500ms debounce

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (result: GeoResult) => {
    onChange({
      lat: result.lat,
      lng: result.lng,
      region: result.label,
    });
    setQuery('');
    setShowDropdown(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    onChange({ lat: '', lng: '', region: '' });
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2 border p-3 bg-slate-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-200 transition-colors">
        {isSearching ? (
          <Loader2 size={14} className="text-slate-400 animate-spin" />
        ) : (
          <Search size={14} className="text-slate-400" />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={displayValue || t('config.geoSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) {
              setShowDropdown(true);
            }
          }}
          className="w-full text-xs bg-transparent border-none outline-none font-medium"
        />
        {value.region && (
          <button
            onClick={handleClear}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
            title="Clear location"
          >
            ×
          </button>
        )}
      </div>

      {/* Current selection display */}
      {value.region && !showDropdown && (
        <div className="mt-2 p-2 bg-violet-50 border border-violet-200 rounded text-[10px] flex items-start gap-2">
          <MapPin size={12} className="text-violet-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-violet-900 truncate">{value.region}</div>
            <div className="text-violet-600 font-mono mt-0.5">
              {value.lat && value.lng && `${parseFloat(value.lat).toFixed(4)}°, ${parseFloat(value.lng).toFixed(4)}°`}
            </div>
          </div>
        </div>
      )}

      {/* Dropdown results */}
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 shadow-xl max-h-64 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
          {results.map((result, index) => (
            <button
              key={`${result.lat}-${result.lng}`}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full text-left px-3 py-2 text-xs flex items-start gap-2 transition-colors ${
                index === selectedIndex
                  ? 'bg-violet-100 text-violet-900'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <MapPin
                size={12}
                className={`mt-0.5 flex-shrink-0 ${
                  index === selectedIndex ? 'text-violet-600' : 'text-slate-400'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{result.label}</div>
                <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                  {parseFloat(result.lat).toFixed(4)}°, {parseFloat(result.lng).toFixed(4)}°
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results message */}
      {showDropdown && !isSearching && results.length === 0 && query.trim().length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 shadow-xl p-4 text-center text-xs text-slate-400">
          {t('config.geoNoResults')}
        </div>
      )}
    </div>
  );
};
