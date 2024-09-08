/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { getSpecificDaysLabel } from './utils.js';

export const treatmentsFactory = new Gtk.SignalListItemFactory();

treatmentsFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
		height_request: 64,
	});
	const icon = new Gtk.Image({
		margin_start: 16,
		margin_end: 6,
		icon_name: 'pill-symbolic',
	});
	box.append(icon);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 8,
		margin_end: 11,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});
	labelsBox.append(name);
	const info = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(info);
	const durationNextDateLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		visible: false,
		margin_top: 1,
	});
	labelsBox.append(durationNextDateLabel);
	const inventoryLabel = new Gtk.Label({
		css_classes: ['badge-box', 'badge-content'],
		valign: Gtk.Align.CENTER,
		margin_end: 5,
		visible: false,
		ellipsize: Pango.EllipsizeMode.END,
	});
	box.append(inventoryLabel);
	const editIcon = new Gtk.Image({
		margin_start: 13,
		margin_end: 18,
		icon_name: 'document-edit-symbolic',
	});
	box.append(editIcon);
	listItem.set_child(box);
});

treatmentsFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.get_child();
	const row = box.get_parent();
	const icon = box.get_first_child();
	const labelsBox = icon.get_next_sibling();
	const nameLabel = labelsBox.get_first_child();
	const infoLabel = nameLabel.get_next_sibling();
	const durationNextDateLabel = infoLabel.get_next_sibling();
	const inventoryLabel = box.get_last_child().get_prev_sibling();
	const today = new Date().setHours(0, 0, 0, 0);
	const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
	const end = new Date(item.duration.end).setHours(0, 0, 0, 0);

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	row.remove_css_class('activatable');
	box.add_css_class('activatable');

	nameLabel.label = item.name;

	const inv = item.inventory;

	if (inv.enabled) {
		let currInv = inv.current < 0 ? 0 : inv.current;

		inventoryLabel.set_visible(true);
		inventoryLabel.label = `${currInv} ` + _('Remaining');
		inventoryLabel.remove_css_class('low-stock');

		if (inv.current <= inv.reminder) {
			inventoryLabel.label = `${currInv} ↓ ` + _('Low stock');
			inventoryLabel.add_css_class('low-stock');
		}
	}

	// TRANSLATORS: label for when duration is enabled
	const startLabel = _('Starts on') + ` ${formatDate(item.duration.start)}`;
	const untilLabel = _('Until') + ` ${formatDate(item.duration.end)}`;
	const endedLabel = _('Ended on') + ` ${formatDate(item.duration.end)}`;

	if (item.duration.enabled && item.frequency !== 'when-needed') {
		durationNextDateLabel.set_visible(true);
		durationNextDateLabel.label = untilLabel;
		if (start > today) {
			durationNextDateLabel.label = startLabel;
		}
	}

	switch (item.frequency) {
		case 'daily':
			infoLabel.label = _('Daily');
			break;
		case 'specific-days':
			infoLabel.label = getSpecificDaysLabel(item);
			break;
		case 'cycle':
			const nextDt = new Date(item.cycleNextDate).setHours(0, 0, 0, 0);
			const nextDate = formatDate(nextDt, 'weekday');

			if (item.duration.enabled) {
				durationNextDateLabel.label = untilLabel;
				if (nextDt > today && nextDt <= end) {
					durationNextDateLabel.label += ' • ' + _('Next dose') + `: ${nextDate}`;
				}
			} else if (nextDt > today) {
				durationNextDateLabel.label = _('Next dose') + `: ${nextDate}`;
			}

			if (nextDt <= today && !item.duration.enabled) {
				durationNextDateLabel.set_visible(false);
			} else {
				durationNextDateLabel.set_visible(true);
			}

			infoLabel.label = _('Cycle') + ' • ';
			infoLabel.label += `${item.cycle[0]}` + ' ⊷ ' + `${item.cycle[1]}`;
			break;
		case 'when-needed':
			infoLabel.label = _('When necessary');
			break;
	}

	if (item.duration.enabled && (end < today || end < start)) {
		durationNextDateLabel.label = endedLabel;
	}

	if (item.notes !== '') {
		infoLabel.label += ` • ${item.notes}`;
	}

	['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'].forEach(c =>
		box.remove_css_class(c),
	);

	box.add_css_class(item.color);

	icon.icon_name = item.icon;

	function formatDate(date, weekday) {
		if (weekday) {
			return new Date(date).toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
			});
		}

		return new Date(date).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	}
});
