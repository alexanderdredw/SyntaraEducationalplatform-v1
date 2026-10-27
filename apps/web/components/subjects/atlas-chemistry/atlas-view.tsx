'use client';

import dynamic from 'next/dynamic';
import { type AtlasRoute } from './routes';

/** REQ-ATL-06.3: каждый экран атласа — отдельный чанк, загружается по требованию. */
const Home = dynamic(() => import('./home'));
const Explore = dynamic(() => import('./explore'));
const Scientists = dynamic(() => import('./scientists'));
const Quiz = dynamic(() => import('./quiz'));
const Search = dynamic(() => import('./search'));
const Glossary = dynamic(() => import('./glossary'));
const Syntara = dynamic(() => import('./syntara'));

/**
 * Экран атласа по адресу (docs/ATLAS_MAP.md, раздел 2). Explore и окно элемента — один компонент: при открытии и
 * закрытии окна сетка не перерисовывается, фильтр и прокрутка сохраняются.
 */
export function AtlasView({ route }: { route: AtlasRoute }) {
  switch (route.screen) {
    case 'home':
      return <Home />;
    case 'explore':
      return <Explore code={route.code} test={route.test === true} />;
    case 'scientists':
      return <Scientists code={route.code} test={route.test === true} />;
    case 'learn':
      return <Quiz />;
    case 'search':
      return <Search />;
    case 'glossary':
      return <Glossary />;
    case 'syntara':
      return <Syntara />;
  }
}
