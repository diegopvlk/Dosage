/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

const decoder = new TextDecoder('utf-8');

const [firstWeekday, firstWorkDay] = getWeekdays();
export { firstWeekday, firstWorkDay };

function getWeekdays() {
	let firstWeekday = 0;
	let firstWorkDay = 1;

	try {
		const [, weekdayOutput] = GLib.spawn_command_line_sync('locale first_weekday');
		const [, workDayOutput] = GLib.spawn_command_line_sync('locale first_workday');

		// minus 1 because `locale` days are 1 to 7
		firstWeekday = +decoder.decode(weekdayOutput) - 1;
		firstWorkDay = +decoder.decode(workDayOutput) - 1;
	} catch (error) {
		console.error(error);
	}

	return [firstWeekday, firstWorkDay];
}

export function getSpecificDaysLabel(item) {
	const workdays = Array.from({ length: 5 }, (_, idx) => (firstWorkDay + idx) % 7);
	const weekends = [0, 6].filter(day => !workdays.includes(day));
	const isWeekend = item.days.every(day => weekends.includes(day));
	const isWeekdays = item.days.every(day => workdays.includes(day));
	const days = item.days;
	let newLabel;

	if (item.days.length === 1) {
		newLabel = getDayLabel(item.days[0], 'long');
	} else if (isWeekend && item.days.length === 2) {
		newLabel = _('Weekends');
	} else if (isWeekdays && item.days.length === 5) {
		newLabel = _('Weekdays');
	} else if (item.days.length === 7) {
		newLabel = _('Daily');
	} else {
		const idx = days.indexOf(firstWeekday);
		const sortedDays = days.slice(idx).concat(days.slice(0, idx));
		newLabel = sortedDays.map(day => getDayLabel(day)).join(', ');
	}

	return newLabel;
}

const [clockIs12, amPmStr, timeDot] = checkClock();
export { clockIs12, amPmStr, timeDot };

function checkClock() {
	let is12 = false;
	let amPmStr = '';
	let timeDot = false;

	try {
		const [, outAmPm] = GLib.spawn_command_line_sync('locale am_pm');
		const [, outTimeFmt] = GLib.spawn_command_line_sync('locale t_fmt');

		const outputAmPm = decoder.decode(outAmPm).replace('\n', '');
		const timeFormat = decoder.decode(outTimeFmt).replace('\n', '');

		amPmStr = outputAmPm === ';' ? amPmStr : outputAmPm;
		amPmStr = amPmStr.split(';');
		is12 = timeFormat.includes('%r') || timeFormat.includes('%p');
		timeDot = timeFormat.includes('.');
	} catch (error) {
		console.error(error);
	}

	return [is12, amPmStr, timeDot];
}

export const DataDir = Gio.file_new_for_path(GLib.build_filenamev([GLib.get_user_data_dir()]));

export function addLeadZero(input) {
	return String(input).padStart(2, 0);
}

export function removeCssColors(colorBtn) {
	const colors = colorBtn.get_css_classes();
	for (const c of colors) {
		if (c.includes('-clr')) {
			colorBtn.remove_css_class(c);
		}
	}
}

export function createTempObj(type, listStore) {
	if (type === 'treatments') {
		const tempObj = {
			treatments: [],
			lastUpdate: new Date().toISOString(),
		};
		for (const it of listStore) {
			const item = it.obj;

			const isValidItem =
				typeof item.name === 'string' &&
				item.name.trim() !== '' && // name cannot be empty
				typeof item.unit === 'string' &&
				item.unit.trim() !== '' && // unit cannot be empty
				typeof item.notes === 'string' &&
				typeof item.frequency === 'string' &&
				// frequency cannot be empty
				(item.frequency !== '' || item.frequency !== 'specific-days') &&
				// if frequency is 'specific-days', 'days' cannot be empty
				(item.frequency !== 'specific-days' || item.days.length > 0) &&
				typeof item.color === 'string' &&
				item.color !== '' && // color cannot be empty
				typeof item.icon === 'string' &&
				item.icon !== '' && // icon cannot be empty
				Array.isArray(item.days) &&
				// days must contain only numbers
				item.days.every(day => typeof day === 'number') &&
				Array.isArray(item.cycle) &&
				item.cycle.length > 0 && // cycle cannot be empty
				// cycle must contain only numbers
				item.cycle.every(day => typeof day === 'number') &&
				Array.isArray(item.dosage) &&
				item.dosage.length > 0 && // dosage must have at least one object
				item.dosage.every(
					d =>
						Array.isArray(d.time) &&
						d.time.length === 2 &&
						typeof d.time[0] === 'number' &&
						typeof d.time[1] === 'number' &&
						typeof d.dose === 'number' &&
						(d.lastTaken === null || typeof d.lastTaken === 'string'),
				) &&
				typeof item.recurring === 'object' &&
				typeof item.recurring.enabled === 'boolean' &&
				typeof item.recurring.interval === 'number' &&
				typeof item.inventory === 'object' &&
				typeof item.inventory.enabled === 'boolean' &&
				typeof item.inventory.current === 'number' &&
				typeof item.inventory.reminder === 'number' &&
				typeof item.duration === 'object' &&
				typeof item.duration.enabled === 'boolean' &&
				typeof item.duration.start === 'number' &&
				typeof item.duration.end === 'number' &&
				// cycleNextDate is present only if frequency is 'cycle'
				(item.frequency !== 'cycle' || typeof item.cycleNextDate === 'string');

			if (isValidItem) {
				tempObj.treatments.push(item);
			} else {
				log('invalid treatment item:', JSON.stringify(item));
				return;
			}
		}
		return tempObj;
	} else if (type === 'history') {
		const tempObj = {
			history: [],
		};

		for (const it of listStore) {
			const item = it.obj;

			const isValidItem =
				typeof item.name === 'string' &&
				item.name.trim() !== '' &&
				typeof item.unit === 'string' &&
				item.unit.trim() !== '' &&
				Array.isArray(item.time) &&
				item.time.length === 2 &&
				typeof item.time[0] === 'number' &&
				typeof item.time[1] === 'number' &&
				typeof item.dose === 'number' &&
				typeof item.color === 'string' &&
				item.color !== '' &&
				Array.isArray(item.taken) &&
				item.taken.length === 2 &&
				typeof item.taken[0] === 'number' &&
				typeof item.taken[1] === 'number';

			if (isValidItem) {
				tempObj.history.push(item);
			} else {
				log('invalid history item:', JSON.stringify(item));
				return;
			}
		}

		return tempObj;
	}
}

export function handleCalendarSelect(calendar, calendarRow, oneTime) {
	const today = GLib.DateTime.new_now_local().format('%F');
	calendar.connect('day-selected', cal => {
		const selDate = cal.get_date().format('%F');

		if (oneTime && selDate > today) {
			(async function () {
				cal.add_css_class('calendar-error');
				await new Promise(res => setTimeout(res, 500));
				cal.remove_css_class('calendar-error');
			})();
			cal.select_day(GLib.DateTime.new_now_local());
		}

		if (!oneTime && selDate < today) {
			cal.add_css_class('calendar-warning');
		} else {
			cal.remove_css_class('calendar-warning');
		}

		calendarRow.subtitle = cal.get_date().format('%x');
	});
}

export function isTodayMedDay(med) {
	const item = med.obj;
	const today = new Date().setHours(0, 0, 0, 0);
	const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
	const end = new Date(item.duration.end).setHours(0, 0, 0, 0);

	if (item.lastTaken != null) {
		return new Date(item.lastTaken) < today;
	}

	if (item.duration.enabled && (start > today || end < today)) {
		return false;
	}

	switch (item.frequency) {
		case 'daily':
			return true;
		case 'specific-days':
			return item.days.includes(new Date().getDay());
		case 'cycle':
			const [active, inactive, current] = item.cycle;
			return current <= active;
		case 'when-needed':
			return false;
	}
}

export function datesPassedDiff(startDate, endDate) {
	const start = new Date(startDate).setHours(0, 0, 0, 0);
	const end = new Date(endDate).setHours(0, 0, 0, 0);
	const daysDiff = Math.floor((end - start) / 86400000);
	const datesPassed = [];

	for (let i = 1; i <= daysDiff; i++) {
		const currentDate = new Date(startDate);
		currentDate.setHours(0, 0, 0, 0);
		currentDate.setDate(currentDate.getDate() + i);
		datesPassed.push(currentDate);
	}

	return datesPassed;
}

/**
 * Find a widget by it's name.
 * @param {widget} parent - The parent widget to search.
 * @param {string} name - The name to be found.
 * @returns {widget} The widget found.
 */
export function getWidgetByName(parent, name, visited = new Set()) {
	if (!parent || visited.has(parent)) return undefined;

	visited.add(parent);

	if (parent.get_name() === name) return parent;

	let result = getWidgetByName(parent.get_first_child(), name, visited);
	if (result) return result;

	let sibling = parent.get_next_sibling();
	while (sibling) {
		result = getWidgetByName(sibling, name, visited);
		if (result) return result;

		sibling = sibling.get_next_sibling();
	}

	try {
		let popover = parent.get_popover();
		if (popover) {
			result = getWidgetByName(popover, name, visited);
			if (result) return result;
		}
	} catch (e) {}
}

export function doseRow(timeDose) {
	let [hours, minutes] = timeDose.time;
	let period = '';

	if (clockIs12) {
		period = hours < 12 ? `${amPmStr[0]}` : `${amPmStr[1]}`;
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const doseRow = new Adw.SpinRow({
		climb_rate: 0.2,
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 999,
			step_increment: 0.25,
			value: timeDose.dose,
		}),
	});
	const doseBox = new Gtk.Box({
		name: 'doseBox',
		css_classes: ['dose-box-time'],
	});
	const removeDoseButton = new Gtk.Button({
		name: 'removeDoseButton',
		css_classes: ['circular', 'destructive-action', 'remove-row'],
		opacity: 0.85,
		valign: Gtk.Align.CENTER,
		margin_end: 4,
		icon_name: 'user-trash-symbolic',
		tooltip_text: _('Delete dose'),
	});
	const doseTimeBox = new Gtk.Box({
		css_classes: ['time-box'],
	});
	doseTimeBox.set_direction(Gtk.TextDirection.LTR);
	const adjHours = new Gtk.Adjustment({
		lower: 0,
		upper: 23,
		step_increment: 1,
		value: hours,
	});
	const spinButtonHours = new Gtk.SpinButton({
		name: 'spinButtonHours',
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjHours,
	});
	const adjMinutes = new Gtk.Adjustment({
		lower: 0,
		upper: 59,
		step_increment: 5,
		value: minutes,
	});
	const spinButtonMinutes = new Gtk.SpinButton({
		name: 'spinButtonMinutes',
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjMinutes,
	});
	const spinButtonSeparator = new Gtk.Label({
		label: ' : ',
	});

	const amPmButton = new Gtk.Button({
		name: 'amPmButton',
		css_classes: ['am-pm', 'flat'],
		valign: Gtk.Align.CENTER,
		label: period,
		visible: clockIs12,
	});

	doseTimeBox.append(spinButtonHours);
	doseTimeBox.append(spinButtonSeparator);
	doseTimeBox.append(spinButtonMinutes);
	doseTimeBox.append(amPmButton);

	const leadZeroHours = clockIs12 ? String(adjHours.value) : addLeadZero(adjHours.value);
	const leadZeroMinutes = addLeadZero(adjMinutes.value);
	const doseTimeButton = new Gtk.MenuButton({
		name: 'doseTimeButton',
		css_classes: ['flat', 'numeric', 'time', 'dose-time'],
		label: timeDot
			? `${leadZeroHours}.${leadZeroMinutes} ${amPmButton.label}`
			: `${leadZeroHours}:${leadZeroMinutes} ${amPmButton.label}`,
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.START,
		popover: new Gtk.Popover({
			child: doseTimeBox,
		}),
	});

	spinButtonHours.connect('output', h => {
		spinButtonHours.text = clockIs12 ? String(h.adjustment.value) : addLeadZero(h.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}:${spinButtonMinutes.text}`;
		if (timeDot) doseTimeButton.label = doseTimeButton.label.replace(':', '.');
		doseTimeButton.label = doseTimeButton.label + ` ${amPmButton.label}`;
		return true;
	});
	spinButtonMinutes.connect('output', m => {
		spinButtonMinutes.text = addLeadZero(m.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}:${spinButtonMinutes.text}`;
		if (timeDot) doseTimeButton.label = doseTimeButton.label.replace(':', '.');
		doseTimeButton.label = doseTimeButton.label + ` ${amPmButton.label}`;
		return true;
	});

	amPmButton.connect('clicked', btn => {
		btn.label = btn.label === `${amPmStr[0]}` ? `${amPmStr[1]}` : `${amPmStr[0]}`;
		doseTimeButton.label = `${spinButtonHours.text}:${spinButtonMinutes.text} ${amPmButton.label}`;
	});

	if (clockIs12) {
		adjHours.lower = 1;
		adjHours.upper = 12;
	}

	const takenLabel = new Gtk.Label({
		css_classes: ['subtitle', 'hist-entry-taken-label'],
		halign: Gtk.Align.START,
		name: 'takenLabel',
		visible: false,
	});

	doseBox.append(takenLabel);
	doseBox.append(removeDoseButton);
	doseBox.append(doseTimeButton);
	doseRow.add_prefix(doseBox);

	doseRow.add_css_class('ampm-row');

	removeDoseButton.connect('clicked', () => {
		removeRow(doseRow);
	});

	return doseRow;
}

export function getTimeBtnInput(currentDoseRow) {
	const doseTimeButton = getWidgetByName(currentDoseRow, 'doseTimeButton');
	const spinButtonHours = getWidgetByName(currentDoseRow, 'spinButtonHours');
	const spinButtonMinutes = getWidgetByName(currentDoseRow, 'spinButtonMinutes');
	const amPmButton = getWidgetByName(currentDoseRow, 'amPmButton');
	const period = amPmButton.label;

	let hours = spinButtonHours.get_value();
	let minutes = spinButtonMinutes.get_value();

	// The time is stored in 24h format
	if (clockIs12) {
		if (period === `${amPmStr[0]}` && hours === 12) hours = 0;
		if (period === `${amPmStr[1]}` && hours !== 12) hours += 12;
	}

	return [hours, minutes, doseTimeButton];
}

export function getDayLabel(day, long) {
	const now = GLib.DateTime.new_now_local();
	const date = now.add_days((day - now.get_day_of_week() + 7) % 7);
	const dayLabel = date.format(long ? '%A' : '%a');
	return dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
}

export const HistorySectionSorter = GObject.registerClass(
	{},
	class HistorySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
			const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);

			return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
		}
	},
);

export const TodaySectionSorter = GObject.registerClass(
	{},
	class TodaySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			const [h1, m1] = a.obj.time;
			const [h2, m2] = b.obj.time;

			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	},
);
