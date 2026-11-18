import React, { createContext, useContext } from 'react';
import type { Track } from '../types/music';

export interface SelectedArtistTarget {
  name: string;
  seedTrack?: Track;
}

interface ArtistNavigationContextValue {
  selectedArtist: SelectedArtistTarget | null;
  openArtistPage: (artistName: string, seedTrack?: Track) => void;
  closeArtistPage: () => void;
}

const ArtistNavigationContext = createContext<ArtistNavigationContextValue>({
  selectedArtist: null,
  openArtistPage: () => {},
  closeArtistPage: () => {},
});

export function ArtistNavigationProvider({
  value,
  children,
}: {
  value: ArtistNavigationContextValue;
  children: React.ReactNode;
}) {
  return (
    <ArtistNavigationContext.Provider value={value}>
      {children}
    </ArtistNavigationContext.Provider>
  );
}

export function useArtistNavigation(): ArtistNavigationContextValue {
  return useContext(ArtistNavigationContext);
}
