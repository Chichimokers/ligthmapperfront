import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from 'react-leaflet';
import { useAuth } from '../hooks/useAuth';
import { useReverseGeocoding } from '../hooks/useReverseGeocoding';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';
import './MapPage.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DEFAULT_LOCATION: [number, number] = [23.1136, -82.3666];
const POLLING_INTERVAL = 5000;

interface LightPoint {
  id: number;
  email: string;
  first_name?: string;
  role: 'user' | 'admin';
  latitude: number;
  longitude: number;
  has_power: boolean;
  last_power_update: string;
}

interface ZoneStats {
  zoneKey: string;
  zoneName: string;
  fullLocation: string;
  total: number;
  withPower: number;
  withoutPower: number;
  percentageWithoutPower: number;
  users: LightPoint[];
  avgLat: number;
  avgLon: number;
}

const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} días`;
};

const MapController = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.flyTo(center, 16, { duration: 1 });
    }
  }, [center, map]);
  
  return null;
};

interface MapClickHandlerProps {
  onMapClick: (lat: number, lng: number) => void;
  enabled: boolean;
}

const MapClickHandler = ({ onMapClick, enabled }: MapClickHandlerProps) => {
  useMapEvents({
    click: (e) => {
      if (enabled) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

const MapPage = () => {
  const { user, loginWithGoogle, logout, updateProfile } = useAuth();
  const { geocodeMultiple } = useReverseGeocoding();
  const [lights, setLights] = useState<LightPoint[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isSettingLocation, setIsSettingLocation] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [zoneStats, setZoneStats] = useState<ZoneStats[]>([]);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState({ current: 0, total: 0 });

  const loadLights = useCallback(async () => {
    try {
      const endpoint = user?.role === 'admin' 
        ? '/api/v1/users/admin/lights/' 
        : '/api/v1/users/lights/';
      const response = await api.get(endpoint);
      setLights(response.data);
    } catch (error) {
      console.error('Error cargando luces:', error);
    }
  }, [user]);

  const refreshLights = async () => {
    setRefreshLoading(true);
    await loadLights();
    setRefreshLoading(false);
  };

  const buildZoneStats = useCallback(async (lightsData: LightPoint[]) => {
    console.log('🔍 buildZoneStats called', { 
      userRole: user?.role, 
      lightsCount: lightsData.length,
      isAdmin: user?.role === 'admin'
    });
    
    if (user?.role !== 'admin' || lightsData.length === 0) {
      console.log('❌ buildZoneStats early return', { 
        roleCheck: user?.role !== 'admin', 
        emptyLights: lightsData.length === 0 
      });
      setZoneStats([]);
      return;
    }

    setGeocodingLoading(true);
    setGeocodingProgress({ current: 0, total: lightsData.length });

    try {
      const uniqueLocations = new Map<string, LightPoint[]>();
      
      for (const light of lightsData) {
        const key = `${light.latitude.toFixed(4)}_${light.longitude.toFixed(4)}`;
        if (!uniqueLocations.has(key)) {
          uniqueLocations.set(key, []);
        }
        uniqueLocations.get(key)!.push(light);
      }

      const locationCoords = Array.from(uniqueLocations.entries()).map(([key, users]) => ({
        lat: users[0].latitude,
        lon: users[0].longitude,
        id: key
      }));

      const geocodedResults = await geocodeMultiple(
        locationCoords,
        (current, total) => setGeocodingProgress({ current, total })
      );

      const zoneMap = new Map<string, {
        users: LightPoint[];
        totalPower: number;
        noPower: number;
        avgLat: number;
        avgLon: number;
        zoneName: string;
        fullLocation: string;
      }>();

      for (const light of lightsData) {
        const key = `${light.latitude.toFixed(4)}_${light.longitude.toFixed(4)}`;
        const geocoded = geocodedResults.get(key);
        
        const zoneKey = geocoded?.suburb || geocoded?.district || geocoded?.city || 'Otros';
        const fullLocation = geocoded?.displayName || zoneKey;

        if (!zoneMap.has(zoneKey)) {
          zoneMap.set(zoneKey, {
            users: [],
            totalPower: 0,
            noPower: 0,
            avgLat: 0,
            avgLon: 0,
            zoneName: zoneKey,
            fullLocation: fullLocation
          });
        }

        const zone = zoneMap.get(zoneKey)!;
        zone.users.push(light);
        if (light.has_power) {
          zone.totalPower++;
        } else {
          zone.noPower++;
        }
        zone.avgLat += light.latitude;
        zone.avgLon += light.longitude;
      }

      const stats: ZoneStats[] = Array.from(zoneMap.entries()).map(([key, zone]) => {
        const count = zone.users.length;
        return {
          zoneKey: key,
          zoneName: zone.zoneName,
          fullLocation: zone.fullLocation,
          total: count,
          withPower: zone.totalPower,
          withoutPower: zone.noPower,
          percentageWithoutPower: Math.round((zone.noPower / count) * 100),
          users: zone.users,
          avgLat: zone.avgLat / count,
          avgLon: zone.avgLon / count
        };
      });

      stats.sort((a, b) => {
        if (b.percentageWithoutPower !== a.percentageWithoutPower) {
          return b.percentageWithoutPower - a.percentageWithoutPower;
        }
        return b.total - a.total;
      });

      setZoneStats(stats);
    } catch (error) {
      console.error('Error building zone stats:', error);
    } finally {
      setGeocodingLoading(false);
    }
  }, [user, geocodeMultiple]);

  const zoomToZone = useCallback((zoneUsers: LightPoint[]) => {
    if (zoneUsers.length === 0) return;
    
    const avgLat = zoneUsers.reduce((sum, u) => sum + u.latitude, 0) / zoneUsers.length;
    const avgLon = zoneUsers.reduce((sum, u) => sum + u.longitude, 0) / zoneUsers.length;
    
    setMapCenter([avgLat, avgLon]);
    setMessage(`📍 ${zoneUsers.length} usuarios en esta zona`);
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // Polling para actualizar puntos en tiempo real
  useEffect(() => {
    loadLights();
    const interval = setInterval(loadLights, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [loadLights]);

  // Build zone stats when sidebar is open and lights change
  useEffect(() => {
    console.log('🔄 useEffect triggered', { showSidebar, userRole: user?.role, lightsCount: lights.length });
    if (showSidebar && user?.role === 'admin' && lights.length > 0) {
      console.log('✅ Calling buildZoneStats');
      buildZoneStats(lights);
    }
  }, [showSidebar, lights, user, buildZoneStats]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => setMapCenter([position.coords.latitude, position.coords.longitude]),
        () => {}
      );
    }
  }, []);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (!user || !isSettingLocation) return;
    
    setLoading(true);
    const result = await updateProfile({
      latitude: parseFloat(lat.toFixed(7)),
      longitude: parseFloat(lng.toFixed(7)),
      has_power: user.has_power ?? false,
    });
    
    if (result.success) {
      setMessage('Ubicación guardada');
      setIsSettingLocation(false);
      loadLights();
    }
    setLoading(false);
  }, [user, isSettingLocation, updateProfile, loadLights]);

  const togglePower = async () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    
    if (!user.latitude || !user.longitude) {
      setMessage('Primero selecciona tu ubicación en el mapa');
      setIsSettingLocation(true);
      return;
    }
    
    setLoading(true);
    const result = await updateProfile({
      has_power: !user.has_power,
    });
    
    if (result.success && result.user) {
      setMessage(result.user.has_power ? '💡 Reportado: Tienes luz' : '🔌 Reportado: Sin luz');
      loadLights();
    }
    setLoading(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const goToMyHome = () => {
    if (user?.latitude && user?.longitude) {
      setMapCenter([user.latitude, user.longitude]);
      setMessage('🏠 Yendo a tu vivienda');
      setTimeout(() => setMessage(null), 2000);
    } else {
      setMessage('No tienes ubicación configurada');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleGoogleSuccess = async (response: { credential: string }) => {
    const result = await loginWithGoogle(response.credential);
    if (result.success) {
      setShowLoginModal(false);
      setMessage('Bienvenido');
    }
  };

  const goToGpsLocation = () => {
    if (!navigator.geolocation) {
      setMessage('GPS no disponible');
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const newCenter: [number, number] = [position.coords.latitude, position.coords.longitude];
        setMapCenter(newCenter);
        setGpsLoading(false);
        setMessage('📍 Ubicación actualizada');
        setTimeout(() => setMessage(null), 2000);
      },
      () => {
        setGpsLoading(false);
        setMessage('Error al obtener GPS');
        setTimeout(() => setMessage(null), 3000);
      },
      { enableHighAccuracy: true }
    );
  };

  const stats = {
    withPower: lights.filter(l => l.has_power).length,
    withoutPower: lights.filter(l => !l.has_power).length,
  };

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="map-page">
        <header className="header">
          <h1>💡 Light Mapper</h1>
          <div className="header-actions">
            {user ? (
              <button onClick={logout} className="btn-user">
                <span className="user-name">{user.first_name || user.email}</span>
                <span className="logout-icon">↩</span>
              </button>
            ) : (
              <button onClick={() => setShowLoginModal(true)} className="btn-login">
                Iniciar Sesión
              </button>
            )}
          </div>
        </header>

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-icon green">●</span>
            <span className="stat-value">{stats.withPower}</span>
            <span className="stat-label">Con luz</span>
          </div>
          <div className="stat">
            <span className="stat-icon red">●</span>
            <span className="stat-value">{stats.withoutPower}</span>
            <span className="stat-label">Sin luz</span>
          </div>
          <div className="stat">
            <span className="stat-icon blue">●</span>
            <span className="stat-value">{lights.length}</span>
            <span className="stat-label">Total</span>
          </div>
        </div>

        {message && (
          <div className="toast-message">{message}</div>
        )}

        <div className="map-container">
          <MapContainer
            center={mapCenter}
            zoom={14}
            className="map"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='© OpenStreetMap'
            />
            
            <MapController center={mapCenter} />
            
            <MapClickHandler
              onMapClick={handleMapClick}
              enabled={isSettingLocation && !!user}
            />
            
            {lights.map((light, index) => (
              <CircleMarker
                key={index}
                center={[light.latitude, light.longitude]}
                pathOptions={{
                  color: light.has_power ? '#22c55e' : '#ef4444',
                  fillColor: light.has_power ? '#22c55e' : '#ef4444',
                  fillOpacity: 0.7,
                }}
                radius={12}
              >
                <Popup>
                  <div className="popup-content">
                    <strong>{light.has_power ? '💡 Con Luz' : '🔌 Sin Luz'}</strong>
                    {user?.role === 'admin' && (
                      <>
                        <br />
                        <small className="popup-email">📧 {light.email}</small>
                        {light.first_name && <small className="popup-name"> 👤 {light.first_name}</small>}
                        {light.role === 'admin' && <span className="popup-admin-badge"> (Admin)</span>}
                      </>
                    )}
                    <br />
                    <small className="popup-time">Hace {formatTimeAgo(light.last_power_update)}</small>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {user?.latitude && user?.longitude && (
              <CircleMarker
                center={[user.latitude, user.longitude]}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.9,
                }}
                radius={15}
              >
                <Popup>
                  <div className="popup-content">
                    <strong>📍 Tu ubicación</strong>
                    <br />
                    <span>{user.has_power ? '💡 Tienes luz' : '🔌 Sin luz'}</span>
                  </div>
                </Popup>
              </CircleMarker>
            )}
          </MapContainer>
          
          <button 
            className="gps-button" 
            onClick={goToGpsLocation}
            disabled={gpsLoading}
            title="Ir a mi ubicación GPS"
          >
            {gpsLoading ? '⏳' : '📍'}
          </button>
          
          <button 
            className="refresh-button" 
            onClick={refreshLights}
            disabled={refreshLoading}
            title="Actualizar puntos"
          >
            {refreshLoading ? '⏳' : '🔄'}
          </button>

          {user?.role === 'admin' && (
            <button 
              className="sidebar-toggle-button" 
              onClick={() => setShowSidebar(!showSidebar)}
              title="Panel Admin"
            >
              {showSidebar ? '✕' : '📊'}
            </button>
          )}
        </div>

        {user?.role === 'admin' && (
          <div className={`admin-sidebar ${showSidebar ? 'open' : ''}`}>
            <div className="sidebar-header">
              <h2>Panel de Admin</h2>
              <button className="sidebar-close" onClick={() => setShowSidebar(false)}>✕</button>
            </div>
            
            <div className="sidebar-section">
              <h3>📍 Estadísticas por Zona</h3>
              
              {geocodingLoading ? (
                <div className="geocoding-loading">
                  <div className="loading-spinner">⏳</div>
                  <p>Cargando ubicaciones...</p>
                  <small>{geocodingProgress.current}/{geocodingProgress.total}</small>
                </div>
              ) : zoneStats.length > 0 ? (
                <div className="zone-list">
                  {zoneStats.map((zone, index) => (
                    <div 
                      key={index} 
                      className="zone-card"
                      onClick={() => zoomToZone(zone.users)}
                    >
                      <div className="zone-header">
                        <strong>{zone.zoneName}</strong>
                        <span className={`zone-badge ${zone.percentageWithoutPower > 70 ? 'danger' : zone.percentageWithoutPower > 40 ? 'warning' : 'success'}`}>
                          {zone.percentageWithoutPower > 70 ? '⚠️' : zone.percentageWithoutPower > 40 ? '⚡' : '✓'}
                        </span>
                      </div>
                      <small className="zone-location">{zone.fullLocation}</small>
                      <div className="zone-stats">
                        <span className="stat-with">💡 {zone.withPower}</span>
                        <span className="stat-without">🔌 {zone.withoutPower}</span>
                      </div>
                      <div className="zone-bar">
                        <div 
                          className={`zone-bar-fill ${zone.percentageWithoutPower > 70 ? 'danger' : zone.percentageWithoutPower > 40 ? 'warning' : 'success'}`}
                          style={{ width: `${zone.percentageWithoutPower}%` }}
                        />
                      </div>
                      <small className="zone-users-count">{zone.total} usuarios</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No hay datos disponibles</p>
              )}
            </div>
            
            <div className="sidebar-section">
              <h3>👥 Lista de Usuarios ({lights.length})</h3>
              <div className="user-list">
                {lights.slice(0, 20).map((light, index) => (
                  <div key={index} className="user-item">
                    <span className={`user-status ${light.has_power ? 'has-power' : 'no-power'}`}>
                      {light.has_power ? '💡' : '🔌'}
                    </span>
                    <div className="user-info">
                      <strong>{light.email}</strong>
                      {light.first_name && <span className="user-name"> ({light.first_name})</span>}
                      {light.role === 'admin' && <span className="user-badge">Admin</span>}
                      <small>{formatTimeAgo(light.last_power_update)}</small>
                    </div>
                  </div>
                ))}
                {lights.length > 20 && (
                  <p className="more-users">+{lights.length - 20} usuarios más</p>
                )}
              </div>
            </div>
          </div>
        )}

        {user && isSettingLocation && (
          <div className="instructions-overlay">
            <div className="instructions-card">
              <h3>📍 Selecciona tu ubicación</h3>
              <p>Toca en el mapa donde está tu casa</p>
              <button onClick={() => setIsSettingLocation(false)} className="btn-cancel">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="bottom-panel">
          {user?.latitude && user?.longitude ? (
            <div className="power-status-card">
              <div className="power-info">
                <span className="power-icon">
                  {user.has_power ? '💡' : '🔌'}
                </span>
                <span className="power-text">
                  {user.has_power ? 'Tienes luz' : 'Sin luz'}
                </span>
              </div>
              <div className="power-actions">
                <button
                  onClick={togglePower}
                  className={`btn-power ${user.has_power ? 'off' : 'on'}`}
                  disabled={loading}
                >
                  {loading ? '...' : user.has_power ? 'Apagar' : 'Encender'}
                </button>
              </div>
            </div>
          ) : (
            <div className="setup-card">
              <p>📍 Configura tu ubicación para reportar</p>
              <button
                onClick={() => {
                  if (!user) {
                    setShowLoginModal(true);
                  } else {
                    setIsSettingLocation(true);
                  }
                }}
                className="btn-setup"
              >
                Seleccionar en mapa
              </button>
            </div>
          )}
          
          <div className="location-actions">
            <button 
              className="btn-location-action"
              onClick={goToMyHome}
              disabled={!user?.latitude || !user?.longitude}
            >
              🏠 Mi Vivienda
            </button>
            <button 
              className="btn-location-action secondary"
              onClick={() => {
                if (!user) {
                  setShowLoginModal(true);
                } else {
                  setIsSettingLocation(true);
                }
              }}
            >
              📍 Cambiar Ubicación
            </button>
          </div>
        </div>

        {showLoginModal && (
          <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowLoginModal(false)}>
                ✕
              </button>
              <h2>Iniciar Sesión</h2>
              <p>Necesitas iniciar sesión para reportar tu estado de luz</p>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setMessage('Error al iniciar sesión')}
                useOneTap
                theme="filled_blue"
                size="large"
                shape="rectangular"
              />
              <div className="privacy-note">
                <small>🔒 Solo usamos tu email para crear tu cuenta. Nunca compartimos tu información.</small>
              </div>
            </div>
          </div>
        )}
      </div>
    </GoogleOAuthProvider>
  );
};

export default MapPage;
