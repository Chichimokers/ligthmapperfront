import { AuthProvider } from './hooks/useAuth';
import MapPage from './pages/MapPage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <MapPage />
    </AuthProvider>
  );
}

export default App;
