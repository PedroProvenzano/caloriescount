import { defineConfig } from 'vite';

export default defineConfig({
  // 'base' configurado como './' (relativo) permite que el bundle funcione 
  // tanto si lo subes a la raíz de tu cuenta de GitHub (ej: https://usuario.github.io/)
  // como si lo subes a una subruta/repositorio (ej: https://usuario.github.io/nombre-repositorio/)
  // sin necesidad de reconfigurar la base en cada despliegue.
  base: './',
});
