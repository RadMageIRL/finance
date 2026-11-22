// The shared script of the dashboard pages (loaded by src/layouts/DataLayout.astro and the
// design-system page): statuses at view time, the newer-data check, charts and switches. Each
// part only enhances what the build already rendered; without it every page is complete.
import { wireCharts } from './chart';
import { checkForNewerData } from './refresh';
import { refreshStatuses } from './status';
import { wireSwitches } from './switch';

refreshStatuses();
wireCharts();
wireSwitches();
void checkForNewerData();
