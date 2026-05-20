import './style.css';
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase.js';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  where,
  setDoc,
  getDoc,
  orderBy
} from 'firebase/firestore';

// ==========================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================================================
const state = {
  user: null,               // Objeto del usuario autenticado (Firebase o local)
  isLocalMode: false,       // true si se navega sin Firebase
  dailyGoal: 2000,          // Calorías meta por defecto
  todayMeals: [],           // Comidas registradas hoy
  tempMeal: null,           // Comida que se está analizando y espera confirmación
  cameraStream: null,       // Stream activo de la cámara
  facingMode: 'environment', // Dirección de la cámara ('user' o 'environment')
  videoDevices: [],         // Dispositivos de video disponibles
  currentDeviceIdx: 0,      // Índice de la cámara actual
  geminiKey: localStorage.getItem('ns_gemini_key') || '' // API Key guardada localmente
};

// Configuración de macros objetivo estimados (en base a la meta de calorías)
// Distribución típica: 50% Carbs, 25% Proteína, 25% Grasa
function getMacroTargets(caloriesGoal) {
  return {
    carbs: Math.round((caloriesGoal * 0.50) / 4),
    protein: Math.round((caloriesGoal * 0.25) / 4),
    fat: Math.round((caloriesGoal * 0.25) / 9),
    fiber: 30 // Meta fija general de fibra
  };
}

// Platos simulados de alta fidelidad para el Modo Demo
const MOCK_MEALS = [
  {
    mealName: "Milanesa de Pollo con Puré de Papas",
    calories: 680,
    protein: 38,
    carbs: 55,
    fat: 26,
    fiber: 4,
    confidence: "high",
    items: [
      { name: "Milanesa de Pollo (Frita)", amount: "1 unidad grande (180g)", calories: 420 },
      { name: "Puré de Papas con Leche y Manteca", amount: "1 porción (150g)", calories: 210 },
      { name: "Aceite de cocción estimado", amount: "1 cucharadita (5ml)", calories: 50 }
    ],
    healthAdvice: "Este plato es rico en proteínas gracias al pollo, pero el método de cocción frito eleva el aporte de grasas. Sugerimos cocinar la milanesa al horno y acompañar con ensalada verde para aumentar la fibra y volumen del plato con menos calorías."
  },
  {
    mealName: "Ensalada César con Pollo Grillado",
    calories: 450,
    protein: 28,
    carbs: 12,
    fat: 32,
    fiber: 3,
    confidence: "high",
    items: [
      { name: "Pechuga de pollo grillada", amount: "120g", calories: 165 },
      { name: "Lechuga romana", amount: "2 tazas", calories: 15 },
      { name: "Crutones de pan", amount: "1/2 taza", calories: 80 },
      { name: "Queso parmesano rallado", amount: "2 cucharadas", calories: 44 },
      { name: "Aderezo César comercial", amount: "2 cucharadas (30ml)", calories: 146 }
    ],
    healthAdvice: "Una ensalada César es una excelente fuente de proteínas magras. Sin embargo, ten cuidado con el aderezo César y los crutones, ya que representan más del 50% de las calorías del plato. Podrías reducir la porción de aderezo a la mitad para aligerar la comida."
  },
  {
    mealName: "Pizza de Muzzarella (2 Porciones)",
    calories: 580,
    protein: 24,
    carbs: 68,
    fat: 22,
    fiber: 4,
    confidence: "medium",
    items: [
      { name: "Masa de pizza de trigo", amount: "2 porciones medianas", calories: 320 },
      { name: "Queso Muzzarella", amount: "80g", calories: 200 },
      { name: "Salsa de tomate casera", amount: "4 cucharadas", calories: 30 },
      { name: "Aceitunas verdes", amount: "2 unidades", calories: 30 }
    ],
    healthAdvice: "La pizza aporta una buena dosis de calcio y carbohidratos para energía. Sin embargo, tiene un índice glucémico alto y un contenido elevado de sodio. Te aconsejamos agregar vegetales como rúcula, espinaca o champiñones encima para enriquecerla con micronutrientes y fibra."
  },
  {
    mealName: "Plato de Sushi Variado (10 piezas)",
    calories: 390,
    protein: 16,
    carbs: 65,
    fat: 6,
    fiber: 2,
    confidence: "high",
    items: [
      { name: "Rolls de Salmón y Palta", amount: "5 piezas", calories: 210 },
      { name: "Maki de Pepino y Pescado Blanco", amount: "5 piezas", calories: 150 },
      { name: "Salsa de soja tradicional", amount: "2 cucharadas (30ml)", calories: 30 }
    ],
    healthAdvice: "El sushi es bajo en grasas saturadas y el salmón aporta ácidos grasos saludables Omega-3. El contenido calórico proviene principalmente del arroz blanco aderezado con azúcar. Monitorea el consumo de salsa de soja por su alto contenido en sodio."
  }
];

// ==========================================================================
// ELEMENTOS DEL DOM
// ==========================================================================
const DOM = {
  appLoading: document.getElementById('app-loading'),
  loginScreen: document.getElementById('login-screen'),
  mainLayout: document.getElementById('main-layout'),
  btnGoogleLogin: document.getElementById('btn-google-login'),
  btnBypassLogin: document.getElementById('btn-bypass-login'),
  cloudStatusBadge: document.getElementById('cloud-status-badge'),
  userAvatar: document.getElementById('user-avatar'),
  userProfileMenu: document.querySelector('.user-profile-menu'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  btnLogout: document.getElementById('btn-logout'),

  // Paneles de Pestañas
  secDashboard: document.getElementById('sec-dashboard'),
  secScan: document.getElementById('sec-scan'),
  secSettings: document.getElementById('sec-settings'),

  // Botones de Navegación
  navDashboard: document.getElementById('nav-dashboard'),
  navScan: document.getElementById('nav-scan'),
  navSettings: document.getElementById('nav-settings'),

  // Elementos del Dashboard
  circleProgress: document.getElementById('circle-progress'),
  caloriesConsumed: document.getElementById('calories-consumed'),
  caloriesGoalText: document.getElementById('calories-goal-text'),
  caloriesRemainingTxt: document.getElementById('calories-remaining-txt'),
  
  valCarbs: document.getElementById('val-carbs'),
  barCarbs: document.getElementById('bar-carbs'),
  valProtein: document.getElementById('val-protein'),
  barProtein: document.getElementById('bar-protein'),
  valFat: document.getElementById('val-fat'),
  barFat: document.getElementById('bar-fat'),
  valFiber: document.getElementById('val-fiber'),
  barFiber: document.getElementById('bar-fiber'),
  mealsList: document.getElementById('meals-list'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Cámara e Imagen
  webcamVideo: document.getElementById('webcam-video'),
  imagePreview: document.getElementById('image-preview'),
  captureCanvas: document.getElementById('capture-canvas'),
  viewfinderPlaceholder: document.getElementById('viewfinder-placeholder'),
  scanLaser: document.getElementById('scan-laser'),
  cameraStatus: document.getElementById('camera-status'),
  btnToggleCamera: document.getElementById('btn-toggle-camera'),
  btnSwitchCamera: document.getElementById('btn-switch-camera'),
  btnCapture: document.getElementById('btn-capture'),
  btnUploadFile: document.getElementById('btn-upload-file'),
  fileInput: document.getElementById('file-input'),

  // Ajustes
  inputDailyCalories: document.getElementById('input-daily-calories'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  inputGeminiKey: document.getElementById('input-gemini-key'),
  btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),
  geminiStatusBox: document.getElementById('gemini-status-box'),
  geminiStatusText: document.getElementById('gemini-status-text'),
  btnSaveGeminiKey: document.getElementById('btn-save-gemini-key'),
  btnClearGeminiKey: document.getElementById('btn-clear-gemini-key'),

  // Modal de Resultados
  resultModal: document.getElementById('result-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  resultImg: document.getElementById('result-img'),
  resultCalories: document.getElementById('result-calories'),
  resultMealName: document.getElementById('result-meal-name'),
  resultConfidenceVal: document.getElementById('result-confidence-val'),
  resultCarbs: document.getElementById('result-carbs'),
  resultProtein: document.getElementById('result-protein'),
  resultFat: document.getElementById('result-fat'),
  resultFiber: document.getElementById('result-fiber'),
  resultIngredientsBody: document.getElementById('result-ingredients-body'),
  resultAdvice: document.getElementById('result-advice'),
  btnDiscardMeal: document.getElementById('btn-discard-meal'),
  btnSaveMeal: document.getElementById('btn-save-meal'),

  // Loader global e indicador de carga
  globalLoader: document.getElementById('global-loader'),
  toastContainer: document.getElementById('toast-container')
};

// Suscripción activa a Firestore (para poder cancelarla al cerrar sesión)
let unsubscribeMeals = null;
let unsubscribeSettings = null;

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconClass = 'fa-circle-check';
  if (type === 'error') iconClass = 'fa-circle-exclamation';
  if (type === 'info') iconClass = 'fa-circle-info';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <span class="toast-message">${message}</span>
    <button class="toast-close">&times;</button>
  `;

  // Botón cerrar
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  DOM.toastContainer.appendChild(toast);

  // Auto eliminar después de 4 segundos
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'toastSlideIn 0.3s reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ==========================================================================
// SISTEMA DE NAVEGACIÓN (TABS)
// ==========================================================================
function setupNavigation() {
  const tabs = [
    { button: DOM.navDashboard, panel: DOM.secDashboard },
    { button: DOM.navScan, panel: DOM.secScan },
    { button: DOM.navSettings, panel: DOM.secSettings }
  ];

  tabs.forEach(tab => {
    tab.button.addEventListener('click', () => {
      // Remover clases activas de todos los botones y paneles
      tabs.forEach(t => {
        t.button.classList.remove('active');
        t.panel.classList.remove('active');
      });

      // Activar la actual
      tab.button.classList.add('active');
      tab.panel.classList.add('active');

      // Apagar cámara si salimos de la pestaña de escaneo
      if (tab.button !== DOM.navScan) {
        stopCamera();
      }
    });
  });

  // Toggle menú de perfil al hacer click en el avatar (para móviles sin hover)
  if (DOM.userAvatar && DOM.userProfileMenu) {
    DOM.userAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      DOM.userProfileMenu.classList.toggle('active');
    });

    // Cerrar el menú si se hace click fuera de él
    document.addEventListener('click', () => {
      DOM.userProfileMenu.classList.remove('active');
    });
  }
}

// Control de versión para forzar la actualización del caché en el móvil
async function checkAppVersion() {
  try {
    const response = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const currentVersion = localStorage.getItem('ns_app_version');
      if (currentVersion && currentVersion !== String(data.version)) {
        localStorage.setItem('ns_app_version', String(data.version));
        // Forzar recarga completa ignorando caché
        window.location.reload(true);
      } else if (!currentVersion) {
        localStorage.setItem('ns_app_version', String(data.version));
      }
    }
  } catch (err) {
    console.warn("No se pudo verificar la versión de la app:", err);
  }
}

// ==========================================================================
// INICIALIZACIÓN DE LA APLICACIÓN & FLUJO DE AUTENTICACIÓN
// ==========================================================================
async function initApp() {
  await checkAppVersion();
  setupNavigation();
  setupCameraControls();
  setupSettingsControls();
  setupModalControls();

  // Configurar campos en la interfaz
  if (state.geminiKey) {
    DOM.inputGeminiKey.value = state.geminiKey;
    updateGeminiKeyStatus();
  }

  // Listener para el login con bypass (modo local offline)
  DOM.btnBypassLogin.addEventListener('click', () => {
    setupLocalMode();
  });

  // Verificar si Firebase está habilitado
  if (isFirebaseConfigured) {
    DOM.btnGoogleLogin.addEventListener('click', handleGoogleLogin);
    DOM.btnLogout.addEventListener('click', handleLogout);

    // Capturar el resultado del redireccionamiento si viene de un login en móvil
    getRedirectResult(auth)
      .then((result) => {
        if (result && result.user) {
          showToast("Sesión iniciada correctamente", "success");
        }
      })
      .catch((error) => {
        console.error("Error en resultado de redirección:", error);
        showToast("Error al iniciar sesión: " + error.message, "error");
      });

    // Listener de estado de Firebase Auth
    onAuthStateChanged(auth, (user) => {
      DOM.appLoading.classList.add('hidden');
      if (user) {
        setupCloudMode(user);
      } else {
        // Mostrar pantalla de Login
        DOM.loginScreen.classList.remove('hidden');
        DOM.mainLayout.classList.add('hidden');
        stopAllSubscriptions();
      }
    });
  } else {
    // Si Firebase no está configurado, iniciar inmediatamente en modo local
    DOM.appLoading.classList.add('hidden');
    setupLocalMode();
  }
}

// Activar el modo local (sin nube)
function setupLocalMode() {
  state.isLocalMode = true;
  state.user = {
    displayName: "Usuario Local",
    email: "local@nutriscan.internal",
    photoURL: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"
  };

  DOM.loginScreen.classList.add('hidden');
  DOM.mainLayout.classList.remove('hidden');
  
  DOM.cloudStatusBadge.className = "badge local";
  DOM.cloudStatusBadge.innerHTML = '<i class="fa-solid fa-cloud-slash"></i> Modo Local';

  DOM.userAvatar.src = state.user.photoURL;
  DOM.userName.textContent = state.user.displayName;
  DOM.userEmail.textContent = state.user.email;

  // En modo local no hay botón de cerrar sesión completo, simplemente reinicia o avisa
  DOM.btnLogout.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restablecer App';
  DOM.btnLogout.addEventListener('click', () => {
    localStorage.clear();
    location.reload();
  });

  // Cargar meta diaria e historial de localStorage
  state.dailyGoal = parseInt(localStorage.getItem('ns_daily_goal')) || 2000;
  DOM.inputDailyCalories.value = state.dailyGoal;

  loadLocalMeals();
  updateDashboard();
  showToast("Ejecutando en Modo Local (los datos se guardan en este navegador)", "info");
}

// Activar el modo nube con Firebase
function setupCloudMode(user) {
  state.isLocalMode = false;
  state.user = user;

  DOM.loginScreen.classList.add('hidden');
  DOM.mainLayout.classList.remove('hidden');

  DOM.cloudStatusBadge.className = "badge";
  DOM.cloudStatusBadge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizado';

  DOM.userAvatar.src = user.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150";
  DOM.userName.textContent = user.displayName || "Usuario de NutriScan";
  DOM.userEmail.textContent = user.email || "";

  // Escuchar en tiempo real las configuraciones del usuario
  listenUserSettings();
  // Escuchar en tiempo real el historial de comidas del día
  listenTodayMeals();
}

async function handleGoogleLogin() {
  try {
    DOM.btnGoogleLogin.disabled = true;
    
    // Detectar si es un navegador móvil o pantalla chica
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    
    if (isMobile) {
      // En móviles los popup se bloquean. Usamos la redirección nativa de Firebase
      await signInWithRedirect(auth, googleProvider);
    } else {
      // En ordenadores usamos la clásica ventana emergente
      await signInWithPopup(auth, googleProvider);
      showToast("Sesión iniciada correctamente", "success");
    }
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    showToast("Error al iniciar sesión con Google: " + error.message, "error");
    DOM.btnGoogleLogin.disabled = false;
  }
}

async function handleLogout() {
  try {
    stopAllSubscriptions();
    await signOut(auth);
    showToast("Sesión cerrada", "info");
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    showToast("Error al cerrar sesión", "error");
  }
}

function stopAllSubscriptions() {
  if (unsubscribeMeals) unsubscribeMeals();
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeMeals = null;
  unsubscribeSettings = null;
}

// ==========================================================================
// PERSISTENCIA & SINCRONIZACIÓN DE DATOS (Firebase vs LocalStorage)
// ==========================================================================

// Escuchar cambios en los ajustes del usuario desde Firebase
function listenUserSettings() {
  const docRef = doc(db, "users", state.user.uid, "settings", "goals");
  unsubscribeSettings = onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      state.dailyGoal = docSnap.data().dailyCalories || 2000;
    } else {
      state.dailyGoal = 2000;
    }
    DOM.inputDailyCalories.value = state.dailyGoal;
    updateDashboard();
  }, (err) => {
    console.error("Error al suscribirse a los ajustes:", err);
  });
}

// Escuchar cambios en las comidas de hoy desde Firebase
function listenTodayMeals() {
  const todayStr = new Date().toLocaleDateString('sv'); // Formato YYYY-MM-DD
  const mealsCol = collection(db, "users", state.user.uid, "meals");
  const q = query(mealsCol, where("dateString", "==", todayStr));

  unsubscribeMeals = onSnapshot(q, (querySnapshot) => {
    state.todayMeals = [];
    querySnapshot.forEach((docSnap) => {
      state.todayMeals.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });
    
    // Ordenar las comidas localmente por fecha/hora para no requerir índice compuesto en Firestore
    state.todayMeals.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeA - timeB;
    });

    updateDashboard();
  }, (err) => {
    console.error("Error al escuchar comidas del día:", err);
    showToast("Error de sincronización con la base de datos.", "error");
  });
}

// Cargar comidas locales de hoy desde LocalStorage
function loadLocalMeals() {
  const todayStr = new Date().toLocaleDateString('sv');
  const allMeals = JSON.parse(localStorage.getItem('ns_meals_history')) || [];
  // Filtrar solo las de hoy
  state.todayMeals = allMeals.filter(m => m.dateString === todayStr);
}

// Guardar comida en el historial
async function saveMealToHistory(meal) {
  const todayStr = new Date().toLocaleDateString('sv');
  const mealDoc = {
    ...meal,
    dateString: todayStr,
    timestamp: new Date().toISOString()
  };

  if (state.isLocalMode) {
    // LocalStorage
    const allMeals = JSON.parse(localStorage.getItem('ns_meals_history')) || [];
    mealDoc.id = 'local_' + Date.now();
    allMeals.push(mealDoc);
    localStorage.setItem('ns_meals_history', JSON.stringify(allMeals));
    
    loadLocalMeals();
    updateDashboard();
    showToast("Comida registrada en almacenamiento local");
  } else {
    // Firebase Firestore
    try {
      DOM.globalLoader.classList.remove('hidden');
      const mealsCol = collection(db, "users", state.user.uid, "meals");
      await addDoc(mealsCol, mealDoc);
      showToast("Comida sincronizada en la nube");
    } catch (error) {
      console.error("Error al guardar en Firestore:", error);
      showToast("Error al guardar en la nube: " + error.message, "error");
    } finally {
      DOM.globalLoader.classList.add('hidden');
    }
  }
}

// Borrar una comida individual
async function deleteMeal(mealId) {
  if (state.isLocalMode) {
    let allMeals = JSON.parse(localStorage.getItem('ns_meals_history')) || [];
    allMeals = allMeals.filter(m => m.id !== mealId);
    localStorage.setItem('ns_meals_history', JSON.stringify(allMeals));
    
    loadLocalMeals();
    updateDashboard();
    showToast("Comida eliminada del almacenamiento local");
  } else {
    try {
      DOM.globalLoader.classList.remove('hidden');
      const mealDocRef = doc(db, "users", state.user.uid, "meals", mealId);
      await deleteDoc(mealDocRef);
      showToast("Comida eliminada de la nube");
    } catch (error) {
      console.error("Error al borrar en Firestore:", error);
      showToast("Error al eliminar de la nube", "error");
    } finally {
      DOM.globalLoader.classList.add('hidden');
    }
  }
}

// Limpiar historial de hoy
async function clearTodayHistory() {
  if (confirm("¿Estás seguro de que deseas vaciar todo el registro de comidas de hoy?")) {
    if (state.isLocalMode) {
      const todayStr = new Date().toLocaleDateString('sv');
      let allMeals = JSON.parse(localStorage.getItem('ns_meals_history')) || [];
      allMeals = allMeals.filter(m => m.dateString !== todayStr);
      localStorage.setItem('ns_meals_history', JSON.stringify(allMeals));
      
      loadLocalMeals();
      updateDashboard();
      showToast("Registro diario vaciado");
    } else {
      try {
        DOM.globalLoader.classList.remove('hidden');
        // Para borrar en lote en el cliente lo hacemos borrando cada doc obtenido
        const promises = state.todayMeals.map(m => {
          return deleteDoc(doc(db, "users", state.user.uid, "meals", m.id));
        });
        await Promise.all(promises);
        showToast("Registro diario en la nube vaciado");
      } catch (error) {
        console.error("Error al vaciar lote:", error);
        showToast("Error al vaciar historial en la nube", "error");
      } finally {
        DOM.globalLoader.classList.add('hidden');
      }
    }
  }
}

// ==========================================================================
// RENDERIZADO DEL DASHBOARD (CALORÍAS, MACROS, HISTORIAL)
// ==========================================================================
function updateDashboard() {
  // 1. Sumar totales del día
  let totalCalories = 0;
  let totalCarbs = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalFiber = 0;

  state.todayMeals.forEach(meal => {
    totalCalories += meal.calories || 0;
    totalCarbs += meal.carbs || 0;
    totalProtein += meal.protein || 0;
    totalFat += meal.fat || 0;
    totalFiber += meal.fiber || 0;
  });

  // Redondear totales
  totalCalories = Math.round(totalCalories);
  totalCarbs = Math.round(totalCarbs);
  totalProtein = Math.round(totalProtein);
  totalFat = Math.round(totalFat);
  totalFiber = Math.round(totalFiber);

  // 2. Actualizar Textos
  DOM.caloriesConsumed.textContent = totalCalories;
  DOM.caloriesGoalText.textContent = state.dailyGoal;

  const remaining = state.dailyGoal - totalCalories;
  if (remaining >= 0) {
    DOM.caloriesRemainingTxt.textContent = `Te quedan ${remaining} kcal para hoy`;
    DOM.caloriesRemainingTxt.className = "progress-subtext";
  } else {
    DOM.caloriesRemainingTxt.textContent = `¡Has superado tu meta por ${Math.abs(remaining)} kcal!`;
    DOM.caloriesRemainingTxt.className = "progress-subtext text-danger";
  }

  // 3. Progreso Circular
  const percent = Math.min((totalCalories / state.dailyGoal) * 100, 100);
  const strokeCircumference = 283; // 2 * pi * 45
  const strokeDashoffset = strokeCircumference - (percent / 100) * strokeCircumference;
  DOM.circleProgress.style.strokeDashoffset = strokeDashoffset;

  // Cambiar el color del círculo a rojo si se pasa del límite
  if (totalCalories > state.dailyGoal) {
    DOM.circleProgress.style.stroke = "var(--color-fat)";
  } else {
    DOM.circleProgress.style.stroke = "var(--color-primary)";
  }

  // 4. Progreso de Macronutrientes
  const targets = getMacroTargets(state.dailyGoal);

  DOM.valCarbs.textContent = `${totalCarbs}g`;
  DOM.valProtein.textContent = `${totalProtein}g`;
  DOM.valFat.textContent = `${totalFat}g`;
  DOM.valFiber.textContent = `${totalFiber}g`;

  DOM.barCarbs.style.width = `${Math.min((totalCarbs / targets.carbs) * 100, 100)}%`;
  DOM.barProtein.style.width = `${Math.min((totalProtein / targets.protein) * 100, 100)}%`;
  DOM.barFat.style.width = `${Math.min((totalFat / targets.fat) * 100, 100)}%`;
  DOM.barFiber.style.width = `${Math.min((totalFiber / targets.fiber) * 100, 100)}%`;

  // Actualizar targets en la interfaz
  document.querySelector('.macro-item:nth-child(1) .macro-target').textContent = `/ ${targets.carbs}g`;
  document.querySelector('.macro-item:nth-child(2) .macro-target').textContent = `/ ${targets.protein}g`;
  document.querySelector('.macro-item:nth-child(3) .macro-target').textContent = `/ ${targets.fat}g`;
  document.querySelector('.macro-item:nth-child(4) .macro-target').textContent = `/ ${targets.fiber}g`;

  // 5. Historial de Comidas
  renderMealsList();
}

function renderMealsList() {
  DOM.mealsList.innerHTML = '';
  
  if (state.todayMeals.length === 0) {
    DOM.mealsList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-utensils empty-icon"></i>
        <p>No has registrado comidas hoy.</p>
        <p class="subtext">Ve a la pestaña de Escanear para añadir tu primer plato.</p>
      </div>
    `;
    DOM.btnClearHistory.classList.add('hidden');
    return;
  }

  DOM.btnClearHistory.classList.remove('hidden');

  state.todayMeals.forEach(meal => {
    const timeStr = meal.timestamp 
      ? new Date(meal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '--:--';

    const card = document.createElement('div');
    card.className = 'meal-log-card';
    
    // Si no hay imagen en Firestore, usar una de fallback
    const imgUrl = meal.imageB64 ? `data:image/jpeg;base64,${meal.imageB64}` : 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=150';

    card.innerHTML = `
      <img src="${imgUrl}" alt="${meal.mealName}" class="meal-log-img" />
      <div class="meal-log-details">
        <h4 class="meal-log-title" title="${meal.mealName}">${meal.mealName}</h4>
        <div class="meal-log-time">
          <i class="fa-regular fa-clock"></i> ${timeStr}
        </div>
        <div class="meal-log-macros">
          <span>C: ${Math.round(meal.carbs)}g</span>
          <span>P: ${Math.round(meal.protein)}g</span>
          <span>G: ${Math.round(meal.fat)}g</span>
        </div>
      </div>
      <div class="meal-log-right">
        <div class="meal-log-calories">${Math.round(meal.calories)}<span>kcal</span></div>
        <button class="btn-delete-meal" data-id="${meal.id}" title="Eliminar comida">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // Asignar evento de borrado
    card.querySelector('.btn-delete-meal').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMeal(meal.id);
    });

    // Permitir hacer clic en la tarjeta del historial para reabrir el detalle
    card.addEventListener('click', () => {
      openDetailModal(meal, false); // Abrir en modo lectura (sin botones guardar/descartar)
    });

    DOM.mealsList.appendChild(card);
  });
}

// ==========================================================================
// CONTROL DE CÁMARA (Captura y Subida)
// ==========================================================================
function setupCameraControls() {
  DOM.btnToggleCamera.addEventListener('click', toggleCamera);
  DOM.btnSwitchCamera.addEventListener('click', switchCamera);
  DOM.btnCapture.addEventListener('click', capturePhoto);
  
  DOM.btnUploadFile.addEventListener('click', () => {
    DOM.fileInput.click();
  });

  DOM.fileInput.addEventListener('change', handleFileUpload);
}

// Activar o desactivar el feed de la cámara
async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
  } else {
    try {
      DOM.btnToggleCamera.disabled = true;
      
      // Obtener listado de cámaras por si hay más de una (ej. traseras/delanteras)
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      const constraints = {
        video: {
          facingMode: state.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      };

      state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      DOM.webcamVideo.srcObject = state.cameraStream;
      
      DOM.webcamVideo.classList.remove('hidden');
      DOM.imagePreview.classList.add('hidden');
      DOM.viewfinderPlaceholder.classList.add('hidden');
      DOM.cameraStatus.classList.add('active');
      DOM.cameraStatus.textContent = "Cámara activa en vivo";
      
      DOM.btnToggleCamera.innerHTML = '<i class="fa-solid fa-video-slash"></i> <span>Apagar Cámara</span>';
      DOM.btnCapture.disabled = false;

      // Habilitar cambiar cámara si hay más de una disponible
      if (state.videoDevices.length > 1) {
        DOM.btnSwitchCamera.classList.remove('hidden');
      }
    } catch (err) {
      console.error("Error al acceder a la cámara:", err);
      showToast("No se pudo acceder a la cámara. Revisa los permisos.", "error");
      stopCamera();
    } finally {
      DOM.btnToggleCamera.disabled = false;
    }
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  DOM.webcamVideo.srcObject = null;
  DOM.webcamVideo.classList.add('hidden');
  DOM.btnCapture.disabled = true;
  DOM.btnSwitchCamera.classList.add('hidden');
  DOM.cameraStatus.classList.remove('active');
  DOM.cameraStatus.textContent = "Cámara inactiva";
  DOM.btnToggleCamera.innerHTML = '<i class="fa-solid fa-video"></i> <span>Activar Cámara</span>';

  // Mostrar el placeholder si tampoco hay imagen previsualizada
  if (DOM.imagePreview.classList.contains('hidden')) {
    DOM.viewfinderPlaceholder.classList.remove('hidden');
  }
}

// Alternar entre cámara trasera y delantera en móviles
async function switchCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  if (state.cameraStream) {
    stopCamera();
    await toggleCamera();
  }
}

// Capturar frame del video en canvas
function capturePhoto() {
  if (!state.cameraStream) return;

  // Efecto visual de obturador rápido
  DOM.scanLaser.classList.remove('hidden');
  
  // Esperar un instante para simular el obturador y capturar
  setTimeout(() => {
    const ctx = DOM.captureCanvas.getContext('2d');
    
    // Definir tamaño de compresión razonable (máx 640 de ancho) para ahorrar tokens y espacio Firestore
    const scale = Math.min(640 / DOM.webcamVideo.videoWidth, 1);
    DOM.captureCanvas.width = DOM.webcamVideo.videoWidth * scale;
    DOM.captureCanvas.height = DOM.webcamVideo.videoHeight * scale;
    
    ctx.drawImage(DOM.webcamVideo, 0, 0, DOM.captureCanvas.width, DOM.captureCanvas.height);
    
    const dataUrl = DOM.captureCanvas.toDataURL('image/jpeg', 0.8); // 80% compresión
    
    DOM.imagePreview.src = dataUrl;
    DOM.imagePreview.classList.remove('hidden');
    DOM.webcamVideo.classList.add('hidden');
    DOM.viewfinderPlaceholder.classList.add('hidden');
    DOM.scanLaser.classList.add('hidden');

    stopCamera();
    
    // Iniciar análisis
    analyzeFoodImage(dataUrl);
  }, 150);
}

// Carga manual de un archivo de imagen
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast("Por favor selecciona un archivo de imagen válido", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    const dataUrl = event.target.result;
    
    // Para no subir imágenes de muchos megapíxeles directamente a Gemini/Firestore,
    // las dibujamos en un canvas para redimensionarlas antes de procesar
    const img = new Image();
    img.onload = function() {
      const canvas = DOM.captureCanvas;
      const ctx = canvas.getContext('2d');
      
      const scale = Math.min(640 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressedUrl = canvas.toDataURL('image/jpeg', 0.8);

      DOM.imagePreview.src = compressedUrl;
      DOM.imagePreview.classList.remove('hidden');
      DOM.webcamVideo.classList.add('hidden');
      DOM.viewfinderPlaceholder.classList.add('hidden');
      
      // Limpiar input de archivo para que deje subir el mismo si se descarta
      DOM.fileInput.value = '';

      stopCamera();
      analyzeFoodImage(compressedUrl);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

// ==========================================================================
// INTEGRACIÓN CON LA API DE GEMINI
// ==========================================================================

// Desencadena el flujo de análisis
async function analyzeFoodImage(imageDataUrl) {
  DOM.globalLoader.classList.remove('hidden');
  
  // Extraer la parte Base64 limpia
  const base64Image = imageDataUrl.split(',')[1];
  
  // Determinar la clave de la API a usar
  // Prioriza: 1. Ajustes locales, 2. Variable .env
  const activeKey = state.geminiKey || import.meta.env.VITE_GEMINI_API_KEY || '';

  if (!activeKey || activeKey.trim() === '') {
    // No hay API Key configurada -> Modo Simulador Demo
    showToast("Ejecutando análisis simulado (Modo Demo)", "info");
    setTimeout(() => {
      // Elegir comida de la lista al azar
      const mockResult = MOCK_MEALS[Math.floor(Math.random() * MOCK_MEALS.length)];
      
      state.tempMeal = {
        ...mockResult,
        imageB64: base64Image
      };
      
      DOM.globalLoader.classList.add('hidden');
      openDetailModal(state.tempMeal, true);
    }, 2000); // 2 segundos de carga para efecto estético
  } else {
    // Llamar a la API real de Gemini
    try {
      const responseJson = await callGeminiVisionAPI(base64Image, activeKey);
      
      state.tempMeal = {
        ...responseJson,
        imageB64: base64Image
      };
      
      DOM.globalLoader.classList.add('hidden');
      openDetailModal(state.tempMeal, true);
    } catch (error) {
      console.error("Error al analizar con Gemini:", error);
      showToast("Error en análisis: " + error.message, "error");
      DOM.globalLoader.classList.add('hidden');
    }
  }
}

// Realiza la petición POST a la API de Gemini
async function callGeminiVisionAPI(base64Image, apiKey) {
  // Endpoint oficial para Gemini 2.5 Flash
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `Analiza la imagen de comida adjunta. Estima las calorías totales del plato, macronutrientes (proteínas, carbohidratos, grasas y fibra en gramos) e identifica los alimentos/ingredientes clave con su aporte calórico aproximado por porción. Devuelve UNICAMENTE un objeto JSON estructurado exactamente como este ejemplo (sin formato markdown ni texto extra):
  {
    "mealName": "Nombre descriptivo del plato",
    "calories": 450,
    "protein": 25,
    "carbs": 40,
    "fat": 15,
    "fiber": 5,
    "confidence": "high" (o "medium" o "low" dependiendo de la claridad de la foto y de si se ven bien los ingredientes),
    "items": [
      { "name": "Ingrediente o parte del plato 1", "amount": "150g o 1 unidad", "calories": 200 }
    ],
    "healthAdvice": "Breve consejo nutricional o recomendación de salud sobre este plato específico."
  }`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          }
        ]
      }
    ],
    // Solicitar explicitamente tipo JSON
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Error del servidor HTTP ${response.status}`;
    throw new Error(message);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!rawText) {
    throw new Error("No se obtuvo respuesta del modelo Gemini");
  }

  try {
    return extractAndParseJson(rawText);
  } catch (err) {
    console.error("Texto recibido fallido:", rawText);
    throw new Error("No se pudo estructurar el formato de nutrientes de la respuesta");
  }
}

// Limpia el output de Gemini y parsea el JSON
function extractAndParseJson(text) {
  let cleaned = text.trim();
  
  // Eliminar delimitadores markdown de bloque de código json si están presentes
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
  }
  cleaned = cleaned.trim();
  
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

// ==========================================================================
// VENTANA MODAL DE DETALLE (Guardar/Descartar/Mostrar)
// ==========================================================================
function setupModalControls() {
  DOM.btnCloseModal.addEventListener('click', closeModal);
  
  DOM.btnDiscardMeal.addEventListener('click', () => {
    closeModal();
    showToast("Comida descartada", "info");
  });

  DOM.btnSaveMeal.addEventListener('click', async () => {
    if (state.tempMeal) {
      await saveMealToHistory(state.tempMeal);
      state.tempMeal = null;
      closeModal();
      
      // Regresar al dashboard automáticamente para ver el resultado agregado
      DOM.navDashboard.click();
    }
  });
}

function openDetailModal(meal, isPendingSave = false) {
  DOM.resultImg.src = meal.imageB64 ? `data:image/jpeg;base64,${meal.imageB64}` : 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=150';
  DOM.resultCalories.textContent = Math.round(meal.calories);
  DOM.resultMealName.textContent = meal.mealName;
  
  // Nivel de Confianza Badge
  DOM.resultConfidenceVal.textContent = meal.confidence === 'high' ? 'Alta' : meal.confidence === 'medium' ? 'Media' : 'Baja';
  DOM.resultConfidenceVal.className = `badge-confidence ${meal.confidence || 'medium'}`;

  // Macros
  DOM.resultCarbs.textContent = `${Math.round(meal.carbs || 0)}g`;
  DOM.resultProtein.textContent = `${Math.round(meal.protein || 0)}g`;
  DOM.resultFat.textContent = `${Math.round(meal.fat || 0)}g`;
  DOM.resultFiber.textContent = `${Math.round(meal.fiber || 0)}g`;

  // Limpiar y renderizar tabla de ingredientes
  DOM.resultIngredientsBody.innerHTML = '';
  if (meal.items && meal.items.length > 0) {
    meal.items.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${item.name}</strong></td>
        <td>${item.amount || 'N/A'}</td>
        <td class="text-right">${Math.round(item.calories)} kcal</td>
      `;
      DOM.resultIngredientsBody.appendChild(row);
    });
  } else {
    DOM.resultIngredientsBody.innerHTML = '<tr><td colspan="3" class="text-center">No se desglosaron ingredientes individuales.</td></tr>';
  }

  // Consejo
  DOM.resultAdvice.textContent = meal.healthAdvice || "Sin consejos específicos para este plato.";

  // Mostrar u ocultar botones de acción de guardado
  if (isPendingSave) {
    DOM.btnSaveMeal.classList.remove('hidden');
    DOM.btnDiscardMeal.classList.remove('hidden');
  } else {
    DOM.btnSaveMeal.classList.add('hidden');
    DOM.btnDiscardMeal.classList.add('hidden');
  }

  DOM.resultModal.classList.remove('hidden');
}

function closeModal() {
  DOM.resultModal.classList.add('hidden');
}

// ==========================================================================
// CONTROL DE AJUSTES & CONFIGURACIÓN
// ==========================================================================
function setupSettingsControls() {
  // Guardar Ajustes del Perfil (Calorías meta)
  DOM.btnSaveSettings.addEventListener('click', async () => {
    const goal = parseInt(DOM.inputDailyCalories.value);
    if (isNaN(goal) || goal < 1000 || goal > 10000) {
      showToast("Por favor introduce una meta calórica válida entre 1000 y 10000 kcal", "error");
      return;
    }

    state.dailyGoal = goal;

    if (state.isLocalMode) {
      localStorage.setItem('ns_daily_goal', goal);
      updateDashboard();
      showToast("Meta calórica guardada en el navegador");
    } else {
      try {
        DOM.globalLoader.classList.remove('hidden');
        const docRef = doc(db, "users", state.user.uid, "settings", "goals");
        await setDoc(docRef, { dailyCalories: goal });
        showToast("Meta calórica sincronizada en tu cuenta");
      } catch (error) {
        console.error("Error al guardar ajustes en Firebase:", error);
        showToast("Error al guardar ajustes en la nube", "error");
      } finally {
        DOM.globalLoader.classList.add('hidden');
      }
    }
  });

  // Mostrar/Ocultar clave API
  DOM.btnToggleKeyVisibility.addEventListener('click', () => {
    const input = DOM.inputGeminiKey;
    const icon = DOM.btnToggleKeyVisibility.querySelector('i');
    
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'fa-solid fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'fa-solid fa-eye';
    }
  });

  // Guardar API Key
  DOM.btnSaveGeminiKey.addEventListener('click', () => {
    const key = DOM.inputGeminiKey.value.trim();
    if (!key.startsWith('AIzaSy')) {
      showToast("Formato de API Key no válido. Suele comenzar con 'AIzaSy...'", "error");
      return;
    }

    state.geminiKey = key;
    localStorage.setItem('ns_gemini_key', key);
    updateGeminiKeyStatus();
    showToast("API Key de Gemini guardada correctamente");
  });

  // Eliminar API Key
  DOM.btnClearGeminiKey.addEventListener('click', () => {
    state.geminiKey = '';
    DOM.inputGeminiKey.value = '';
    localStorage.removeItem('ns_gemini_key');
    updateGeminiKeyStatus();
    showToast("API Key de Gemini eliminada");
  });

  DOM.btnClearHistory.addEventListener('click', clearTodayHistory);
}

function updateGeminiKeyStatus() {
  const activeKey = state.geminiKey || import.meta.env.VITE_GEMINI_API_KEY || '';
  
  if (activeKey) {
    DOM.geminiStatusBox.className = "api-status-box success";
    
    if (state.geminiKey) {
      DOM.geminiStatusText.innerHTML = '<i class="fa-solid fa-circle-check"></i> Clave configurada en el **almacenamiento local**. Lista para escanear en tiempo real.';
    } else {
      DOM.geminiStatusText.innerHTML = '<i class="fa-solid fa-circle-check"></i> Clave configurada globalmente desde el archivo **.env**. Lista para escanear.';
    }
  } else {
    DOM.geminiStatusBox.className = "api-status-box info";
    DOM.geminiStatusText.innerHTML = '<i class="fa-solid fa-circle-info"></i> Sin clave configurada. La app funciona en **Modo Demo** con datos simulados.';
  }
}

// Iniciar aplicación
window.addEventListener('DOMContentLoaded', initApp);
