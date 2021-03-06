import {remote, ipcRenderer} from 'electron';
import {getWindows} from 'mac-windows';
import {getAppIconListByPid} from 'node-mac-app-icon';
import nearestNormalAspectRatio from 'nearest-normal-aspect-ratio';

const {Menu, nativeImage} = remote;

const RATIOS = [
  '16:9',
  '5:4',
  '5:3',
  '4:3',
  '3:2',
  '1:1'
];

const APP_BLACKLIST = [
  'Kap',
  'Kap Beta',
  'Spotlight',
  'Window Server'
];

const APP_MIN_HEIGHT = 50;
const APP_MIN_WIDTH = 50;

function isAppValid(app) {
  if (
    app.width < APP_MIN_WIDTH ||
    app.height < APP_MIN_HEIGHT ||
    APP_BLACKLIST.includes(app.ownerName) ||
    APP_BLACKLIST.includes(app.name)
  ) {
    return false;
  }
  return true;
}

async function getWindowList() {
  const windows = await getWindows();
  const images = await getAppIconListByPid(windows.map(win => win.pid), {
    size: 16,
    failOnError: false
  });
  const {width, height} = remote.screen.getPrimaryDisplay().bounds;

  return [
    {
      ownerName: 'Fullscreen',
      isFullscreen: true,
      width,
      height
    },
    ...windows
      .filter(isAppValid)
      .map(win => {
        const iconImage = images.find(img => img.pid === win.pid);
        const icon = iconImage.icon ? nativeImage.createFromBuffer(iconImage.icon) : null;
        return Object.assign({}, win, {
          isFullscreen: false,
          icon2x: icon || null,
          icon: icon ? icon.resize({width: 16, height: 16}) : null
        });
      })
  ];
}

function getAppDisplayName(app) {
  const content = document.createElement('span');

  // Prepend the logo
  if (app.icon) {
    const img = document.createElement('img');
    img.className = 'app-logo';
    img.width = 16;
    img.src = app.icon2x.toDataURL();
    content.appendChild(img);
  }

  content.appendChild(document.createTextNode(app.ownerName));
  return content.innerHTML;
}

function updateContent(el, dimensions, windowList) {
  const content = el.querySelector('button');
  if (dimensions.app) {
    const app = windowList.find(win => win.pid === dimensions.app.pid);
    if (app) {
      content.innerHTML = getAppDisplayName(app);
      return;
    }
  }

  const stringRatio = dimensions.ratio.join(':');
  const knownRatio = RATIOS.find(ratio => ratio === stringRatio);
  content.textContent = knownRatio || `Custom (${stringRatio})`;
}

function isAppSelected(dimensions, app) {
  if (!dimensions.app) {
    return false;
  }
  return dimensions.app.pid === app.pid;
}

function isFullscreenSelected(dimensions) {
  if (!dimensions.app) {
    return false;
  }
  return dimensions.app.isFullscreen;
}

function buildMenuItems(options, currentDimensions, windowList) {
  const {emitter, el} = options;
  const [fullscreen, ...windows] = windowList;
  const knownRatio = RATIOS.find(ratio => ratio === currentDimensions.ratio.join(':'));

  updateContent(el, currentDimensions, windowList);

  return Menu.buildFromTemplate([
    {
      label: 'Windows',
      submenu: windows.map(win => ({
        label: win.ownerName,
        icon: win.icon,
        type: 'radio',
        checked: isAppSelected(currentDimensions, win),
        click: () => {
          emitter.emit('app-selected', win);
        }
      }))
    },
    {
      label: 'Fullscreen',
      type: 'checkbox',
      checked: isFullscreenSelected(currentDimensions, fullscreen),
      click: () => {
        emitter.emit('app-selected', fullscreen);
      }
    },
    {
      type: 'separator'
    },
    ...RATIOS.map(ratio => ({
      label: ratio,
      checked: ratio === knownRatio,
      type: 'checkbox',
      click: () => {
        emitter.emit('ratio-selected', ratio);
      }
    })),
    {
      label: 'Custom',
      enabled: false,
      type: 'checkbox',
      checked: !knownRatio && !currentDimensions.app
    }
  ]);
}

// Helper function for retrieving the simplest ratio,
// via the largest common divisor of two numbers (thanks @doot0)
function getLargestCommonDivisor(first, second) {
  if (!first) {
    return 1;
  }

  if (!second) {
    return first;
  }

  return getLargestCommonDivisor(second, first % second);
}

function getSimplestRatio(width, height) {
  const lcd = getLargestCommonDivisor(width, height);
  const denominator = width / lcd;
  const numerator = height / lcd;
  return [denominator, numerator];
}

export function findRatioForSize(width, height) {
  const ratio = nearestNormalAspectRatio(width, height);

  if (ratio) {
    return ratio.split(':').map(part => parseInt(part, 10));
  }

  return getSimplestRatio(width, height);
}

export default async function buildSizeMenu(options) {
  const {emitter, el} = options;
  let {dimensions} = options;
  let windowList = await getWindowList();
  let menu = buildMenuItems(options, dimensions, windowList);

  // Hardcoding 140, because `menu`'s width is not known
  // and there is no way for electorn menus' to be positioned
  // from the right
  const rect = el.getBoundingClientRect();
  const menuX = rect.left + rect.width - 140;
  const menuY = rect.top;

  const rebuild = () => {
    menu = buildMenuItems(options, dimensions, windowList);
  };

  emitter.on('change', newDimensions => {
    dimensions = newDimensions;
    rebuild();
  });

  ipcRenderer.on('reload-apps', async () => {
    windowList = await getWindowList();
    rebuild();
  });

  el.onclick = () => {
    menu.popup({
      x: menuX,
      y: menuY
    });
  };
}
