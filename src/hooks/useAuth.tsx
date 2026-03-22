import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import api from '../services/api';

interface User {
  id: number;
  email: string;
  first_name?: string;
  latitude: number | null;
  longitude: number | null;
  has_power: boolean | null;
  last_power_update: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithGoogle: (credential: string) => Promise<{ success: boolean; user?: User; error?: unknown }>;
  logout: () => void;
  updateProfile: (data: { latitude?: number; longitude?: number; has_power?: boolean }) => Promise<{ success: boolean; user?: User; error?: unknown }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const response = await api.get('/api/v1/users/profile/');
          setUser(response.data);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    try {
      const response = await api.post('/api/v1/users/auth/google/', {
        id_token: credential,
      });
      const { user: userData, tokens } = response.data;
      localStorage.setItem('access_token', tokens.access);
      localStorage.setItem('refresh_token', tokens.refresh);
      setUser(userData);
      return { success: true, user: userData };
    } catch (error) {
      return { success: false, error: (error as { response?: { data?: unknown } }).response?.data };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (data: { latitude?: number; longitude?: number; has_power?: boolean }) => {
    try {
      const response = await api.put('/api/v1/users/profile/', data);
      setUser(response.data);
      return { success: true, user: response.data };
    } catch (error) {
      return { success: false, error: (error as { response?: { data?: unknown } }).response?.data };
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
