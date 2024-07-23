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

export const firstWeekday = getWeekdays()[0];
const firstWorkDay = getWeekdays()[1];

function getWeekdays() {
	let firstWeekday;
	let firstWorkDay;

	const [success0, output0, error0] = GLib.spawn_command_line_sync('locale first_weekday');
	const [success1, output1, error1] = GLib.spawn_command_line_sync('locale first_workday');

	if (success0 && success1) {
		const decoder = new TextDecoder('utf-8');
		// minus 1 because `locale` days are 1 to 7
		firstWeekday = +decoder.decode(output0) - 1;
		firstWorkDay = +decoder.decode(output1) - 1;
	} else {
		log(`Error getting locale: ${(error0, error1)}`);
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

export const clockIs12 = checkClock();

function checkClock() {
	const currentTime = GLib.DateTime.new_now_local();
	const timeFormat = currentTime.format('%X').slice(-2);
	return timeFormat === 'AM' || timeFormat === 'PM';
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
			tempObj.treatments.push(it.obj);
		}
		if (
			tempObj.treatments.some(obj => Object.keys(obj).length === 0) ||
			tempObj.treatments.length === 0
		) {
			log('empty treatments', JSON.stringify(tempObj));
			return;
		}
		return tempObj;
	} else if (type === 'history') {
		const tempObj = {
			history: [],
		};

		for (const it of listStore) {
			const item = it.obj;
			tempObj.history.push({
				name: item.name,
				unit: item.unit,
				time: item.time,
				dose: item.dose,
				color: item.color,
				taken: item.taken,
			});
		}
		if (
			tempObj.history.some(obj => Object.keys(obj).length === 0) ||
			tempObj.history.length === 0
		) {
			log('empty history', JSON.stringify(tempObj));
			return;
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
		period = hours < 12 ? 'AM' : 'PM';
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
	const doseBox = new Gtk.Box();
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

	doseTimeBox.append(spinButtonHours);
	doseTimeBox.append(spinButtonSeparator);
	doseTimeBox.append(spinButtonMinutes);

	const leadZeroHours = clockIs12 ? String(adjHours.value) : addLeadZero(adjHours.value);
	const leadZeroMinutes = addLeadZero(adjMinutes.value);
	const doseTimeButton = new Gtk.MenuButton({
		name: 'doseTimeButton',
		css_classes: ['flat', 'numeric', 'time'],
		label: `${leadZeroHours}∶${leadZeroMinutes}`,
		valign: Gtk.Align.CENTER,
		popover: new Gtk.Popover({
			child: doseTimeBox,
		}),
	});

	spinButtonHours.connect('output', h => {
		spinButtonHours.text = clockIs12 ? String(h.adjustment.value) : addLeadZero(h.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});
	spinButtonMinutes.connect('output', m => {
		spinButtonMinutes.text = addLeadZero(m.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});

	const amPmButton = new Gtk.Button({
		name: 'amPmButton',
		css_classes: ['am-pm', 'circular', 'flat'],
		valign: Gtk.Align.CENTER,
		label: period,
		visible: clockIs12,
	});
	amPmButton.connect('clicked', btn => {
		btn.label = btn.label === 'AM' ? 'PM' : 'AM';
	});

	if (clockIs12) {
		adjHours.lower = 1;
		adjHours.upper = 12;
	}

	doseBox.append(removeDoseButton);
	doseBox.append(doseTimeButton);
	doseBox.append(amPmButton);
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
		if (period === 'AM' && hours === 12) hours = 0;
		if (period === 'PM' && hours !== 12) hours += 12;
	}

	return [hours, minutes, amPmButton, doseTimeButton];
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
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
			const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);

			return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
		}
	},
);

export const HistorySorter = GObject.registerClass(
	{},
	class HistorySorter extends Gtk.Sorter {
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			return a.obj.taken[0] > b.obj.taken[0] ? -1 : 0;
		}
	},
);

export const TodaySectionSorter = GObject.registerClass(
	{},
	class TodaySectionSorter extends Gtk.Sorter {
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			const [h1, m1] = a.obj.time;
			const [h2, m2] = b.obj.time;

			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	},
);
