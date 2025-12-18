'use strict';

import Gtk from 'gi://Gtk?version=4.0';

import { getDosageWindow } from './main.js';
import { treatmentsLS } from './window.js';

export function sortTreatments(sortingType) {
	treatmentsLS.sort(sortTreatFunc(sortingType));
	const dosageWindow = getDosageWindow();
	dosageWindow._treatmentsList.scroll_to(0, Gtk.ListScrollFlags.FOCUS, null);
}

export function sortTreatFunc(sortingType) {
	switch (sortingType) {
		case 'name-ascending':
			return (a, b) => {
				return a.obj.name.localeCompare(b.obj.name);
			};
		case 'amount-remaining-less':
			return (a, b) => {
				const nameA = a.obj.name;
				const nameB = b.obj.name;
				const invA = a.obj.inventory;
				const invB = b.obj.inventory;
				const enabledA = invA.enabled;
				const enabledB = invB.enabled;

				if (enabledA !== enabledB) {
					return enabledA ? -1 : 1;
				}

				if (enabledA && enabledB) {
					const curA = invA.current;
					const curB = invB.current;

					if (curA !== curB) {
						return curA - curB;
					}
				}

				return nameA.localeCompare(nameB);
			};
		case 'amount-remaining-more':
			return (a, b) => {
				const nameA = a.obj.name;
				const nameB = b.obj.name;
				const invA = a.obj.inventory;
				const invB = b.obj.inventory;
				const enabledA = invA.enabled;
				const enabledB = invB.enabled;

				if (enabledA !== enabledB) {
					return enabledA ? -1 : 1;
				}

				if (enabledA && enabledB) {
					const curA = invA.current;
					const curB = invB.current;

					if (curA !== curB) {
						return curB - curA;
					}
				}

				return nameA.localeCompare(nameB);
			};
		default:
			return (a, b) => {
				return a.obj.name.localeCompare(b.obj.name);
			};
	}
}
