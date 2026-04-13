import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-ui': ['lucide-react', '@headlessui/react'],
          'vendor-pdf': ['jspdf'],
          'vendor-charts': ['recharts'],
          'vendor-ckeditor': [
            '@ckeditor/ckeditor5-build-classic',
            '@ckeditor/ckeditor5-react',
            '@ckeditor/ckeditor5-find-and-replace',
            '@ckeditor/ckeditor5-horizontal-line',
            '@ckeditor/ckeditor5-page-break',
            '@ckeditor/ckeditor5-remove-format',
            '@ckeditor/ckeditor5-select-all',
            '@ckeditor/ckeditor5-special-characters',
            '@ckeditor/ckeditor5-word-count',
          ],
          'vendor-survey': [
            'survey-core',
            'survey-react-ui',
            'survey-creator-core',
            'survey-creator-react',
          ],
'vendor-math': ['mathjs'],
          'vendor-misc': ['date-fns', 'qrcode', 'qrcode.react', 'jsbarcode', 'browser-image-compression'],
        }
      }
    }
  }
});
