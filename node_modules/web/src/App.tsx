import React from 'react';
import { GunProvider } from './contexts/GunContext';
import { UserProvider } from './contexts/UserContext';
import { AppRouter } from './AppRouter';
import './App.css';

function App() {
  return (
    <GunProvider>
      <UserProvider>
        <AppRouter />
      </UserProvider>
    </GunProvider>
  );
}

export default App;
