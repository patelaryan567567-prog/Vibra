import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const win = window as unknown as {
  __VIBRA_REACT_MOUNTED__?: boolean;
  __VIBRA_JIO_BOOTED__?: boolean;
};

if (!win.__VIBRA_JIO_BOOTED__) {
  win.__VIBRA_REACT_MOUNTED__ = true;
  createRoot(document.getElementById('root')!).render(<App />);
}


