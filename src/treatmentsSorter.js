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
	const today = new Date();
	today.setHours(0, 0, 0, 0);
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
		case 'when-needed-last':
			return (a, b) => {
				const isNeededA = a.obj.frequency === 'when-needed';
				const isNeededB = b.obj.frequency === 'when-needed';

				if (isNeededA !== isNeededB) {
					return isNeededA ? 1 : -1;
				}
				return a.obj.name.localeCompare(b.obj.name);
			};
		case 'ended-last':
			return (a, b) => {
				const durA = a.obj.duration;
				const durB = b.obj.duration;

				const enabledA = durA.enabled && a.obj.frequency !== 'when-needed';
				const enabledB = durB.enabled && b.obj.frequency !== 'when-needed';

				if (enabledA !== enabledB) return enabledB ? -1 : 1;

				if (enabledA && enabledB) {
					const endA = new Date(durA.end).setHours(0, 0, 0, 0);
					const endB = new Date(durB.end).setHours(0, 0, 0, 0);

					const pastA = endA < today;
					const pastB = endB < today;

					if (pastA !== pastB) return pastB ? 1 : -1;
				}

				return a.obj.name.localeCompare(b.obj.name);
			};
		case 'when-needed-ended-last':
			return (a, b) => {
				const isNeededA = a.obj.frequency === 'when-needed';
				const isNeededB = b.obj.frequency === 'when-needed';

				const durA = a.obj.duration;
				const durB = b.obj.duration;

				const isEndedA =
					!isNeededA && durA.enabled && new Date(durA.end).setHours(0, 0, 0, 0) < today;
				const isEndedB =
					!isNeededB && durB.enabled && new Date(durB.end).setHours(0, 0, 0, 0) < today;

				if (isEndedA !== isEndedB) return isEndedA ? 1 : -1;

				if (isNeededA !== isNeededB) return isNeededA ? 1 : -1;

				return a.obj.name.localeCompare(b.obj.name);
			};
		default:
			return (a, b) => {
				return a.obj.name.localeCompare(b.obj.name);
			};
	}
}
