import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider, createTheme } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useCzechValidationMessages } from '@revize/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiRequestError } from './api/client.js';
import { router } from './router.js';

useCzechValidationMessages();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not hammer the server with retries on 4xx (e.g. not found, forbidden).
      retry: (count, error) =>
        !(error instanceof ApiRequestError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      {/* Bottom: at the top they would cover the header and the close button of side panels. */}
      <Notifications position="bottom-center" />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider labels={{ confirm: 'Potvrdit', cancel: 'Zrušit' }}>
          <RouterProvider router={router} context={{ queryClient }} />
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
