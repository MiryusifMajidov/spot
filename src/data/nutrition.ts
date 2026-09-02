export interface Meal {
  id: string;
  name: string;
  time: string;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  eaten: boolean;
  postWorkout?: boolean;
  ingredients: string[];
}

export const DAILY_TARGET = 2400;

export const meals: Meal[] = [
  { id: 'm1', name: 'Yulaf, banan və qoz', time: 'Səhər · 8:00', kcal: 420, protein: 18, carb: 62, fat: 12, eaten: true, ingredients: ['Yulaf 80 q', 'Banan 1 ədəd', 'Qoz 20 q', 'Süd 200 ml'] },
  { id: 'm2', name: 'Toyuq döşü, düyü və salat', time: 'Nahar · 13:00', kcal: 650, protein: 52, carb: 70, fat: 14, eaten: true, ingredients: ['Toyuq döşü 200 q', 'Düyü 100 q', 'Tərəvəz salatı', 'Zeytun yağı 1 x.q.'] },
  { id: 'm3', name: 'Protein şeyk və banan', time: 'Məşqdən sonra · 18:30', kcal: 320, protein: 34, carb: 40, fat: 4, eaten: false, postWorkout: true, ingredients: ['Zülal tozu 30 q', 'Banan 1 ədəd', 'Su 300 ml'] },
  { id: 'm4', name: 'Balıq, kartof və tərəvəz', time: 'Axşam · 20:30', kcal: 560, protein: 42, carb: 48, fat: 20, eaten: false, ingredients: ['Qızılbalıq 180 q', 'Kartof 200 q', 'Brokoli 150 q'] },
];

export const getMeal = (id: string) => meals.find((m) => m.id === id);

export interface ShopItem {
  id: string;
  name: string;
  qty: string;
  price: number;
  got: boolean;
}

export const shoppingList: ShopItem[] = [
  { id: 's1', name: 'Toyuq döşü', qty: '1 kq', price: 8, got: false },
  { id: 's2', name: 'Qızılbalıq', qty: '400 q', price: 12, got: false },
  { id: 's3', name: 'Yulaf', qty: '500 q', price: 3, got: true },
  { id: 's4', name: 'Düyü', qty: '1 kq', price: 4, got: false },
  { id: 's5', name: 'Banan', qty: '1 kq', price: 2.5, got: false },
  { id: 's6', name: 'Tərəvəz (salat üçün)', qty: '—', price: 6, got: false },
  { id: 's7', name: 'Zülal tozu', qty: '1 kq', price: 35, got: true },
];
