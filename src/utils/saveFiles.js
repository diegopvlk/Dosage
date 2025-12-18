import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { getDosageWindow } from '../main.js';
import { historyLS, treatmentsLS } from '../window.js';
import { getHistoryCSV, getHistoryHTML } from './getHistoryExportFile.js';
import { getTreatmentsHTML } from './getTreatmentsExportFile.js';
import { createTempObj } from './helpers.js';

/** Utility: encode string to Uint8Array */
const encode = str => new TextEncoder().encode(str);

/**
 * Save history in the selected file format.
 *
 * @param {boolean} iso - Include ISO timestamps
 * @param {boolean} html - Export as HTML (otherwise CSV)
 */
export async function saveHistFile(iso, html) {
	const window = getDosageWindow();
	try {
		const baseName = `${_('Dosage')}_${_('History')}${iso ? '_ISO' : ''}`;
		const ext = html ? '.html' : '.csv';

		const dialog = new Gtk.FileDialog({ initial_name: baseName + ext });
		const file = await dialog.save(window, null);

		const { history } = createTempObj('history', historyLS);
		const data = html ? getHistoryHTML(history, iso) : getHistoryCSV(history, iso);

		await file.replace_contents_async(encode(data), null, false, Gio.FileCreateFlags.NONE, null);
	} catch (error) {
		console.error(error);
	}
}

/**
 * Save treatments as a HTML file.
 *
 */
export async function saveTreatFile() {
	const window = getDosageWindow();
	try {
		const baseName = `${_('Dosage')}_${_('Treatments')}`;

		const dialog = new Gtk.FileDialog({ initial_name: `${baseName}.html` });
		const file = await dialog.save(window, null);

		const { treatments } = createTempObj('treatments', treatmentsLS);
		const data = getTreatmentsHTML(treatments);

		await file.replace_contents_async(encode(data), null, false, Gio.FileCreateFlags.NONE, null);
	} catch (error) {
		console.error(error);
	}
}
