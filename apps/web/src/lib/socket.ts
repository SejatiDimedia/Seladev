import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const token = useAuthStore.getState().accessToken;

    socket = io({
      autoConnect: false,
      auth: {
        token,
      },
    });
  }
  return socket;
};

export const connectSocket = () => {
  const token = useAuthStore.getState().accessToken;
  const s = getSocket();

  if (token) {
    s.auth = { token };
    if (!s.connected) {
      s.connect();
    }
  }
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
  }
};

// Monitor token changes in useAuthStore to automatically reconnect socket
useAuthStore.subscribe((state, prevState) => {
  if (state.accessToken !== prevState.accessToken) {
    if (state.accessToken) {
      connectSocket();
    } else {
      disconnectSocket();
    }
  }
});
