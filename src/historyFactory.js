/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';

import { dateFormat, timeFormat } from './utils.js';
import { DosageApplication } from './main.js';
import { historyLS } from './window.js';

export const historyHeaderFactory = new Gtk.SignalListItemFactory();
export const historyItemFactory = new Gtk.SignalListItemFactory();

const histItemHandler = {
	set(target, property, value) {
		if (property === 'length') {
			target[property] = value;
		}

		const DosageWindow = DosageApplication.get_default().activeWindow;
		const noItems = histItemsToRm.length === 0 || histItemsToRm[0] == undefined;

		DosageWindow._removeHistItemsBtn.visible = !noItems;
		DosageWindow._unselectHistItemsBtn.visible = !noItems;
		DosageWindow._toggleHistAmountBtn.visible = noItems && historyLS.n_items > 30;

		target[property] = value;
		return true;
	},
};

export const histItemsToRm = new Proxy([], histItemHandler);

historyHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	listHeaderItem.dateLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listHeaderItem.set_child(listHeaderItem.dateLabel);
});

historyHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item().obj;
	const dateLabel = listHeaderItem.dateLabel;

	const dateTime = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
	const formattedDt = dateTime.format(dateFormat);

	dateLabel.label = formattedDt.charAt(0).toUpperCase() + formattedDt.slice(1);
});

historyItemFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box();

	listItem.checkButton = new Gtk.CheckButton({
		css_classes: ['selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_start: 11,
		tooltip_text: _('Select to be removed'),
	});

	listItem.checkButton.connect('toggled', btn => {
		const item = listItem.get_item();
		const indexToRemove = histItemsToRm.indexOf(item);
		item.checkButton = listItem.checkButton;

		if (item.skipList) {
			item.skipList = !item.skipList;
			return;
		}

		if (btn.active) {
			if (!histItemsToRm.includes(item)) {
				histItemsToRm.push(item);
			}
		} else {
			histItemsToRm.splice(indexToRemove, 1);
		}
	});

	listItem.box.append(listItem.checkButton);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 9,
		margin_end: 10,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.doseLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.doseLabel);

	listItem.takenBox = new Gtk.Box({
		css_classes: ['badge-box'],
		valign: Gtk.Align.CENTER,
		margin_end: 14,
	});

	listItem.takenLabel = new Gtk.Label({
		css_classes: ['badge-content'],
		valign: Gtk.Align.CENTER,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.takenIcon = new Gtk.Image({
		css_classes: ['badge-content', 'badge-icon'],
	});

	listItem.takenBox.append(listItem.takenLabel);
	listItem.takenBox.append(listItem.takenIcon);
	listItem.box.append(listItem.takenBox);
	listItem.set_child(listItem.box);

	listItem.keyController = new Gtk.EventControllerKey();

	// activate item with space bar
	listItem.keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const row = listItem.box.get_parent();
			const listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});

	listItem.controllerAdded = false;
});

historyItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.box;
	const row = box.get_parent();
	const nameLabel = listItem.nameLabel;
	const doseLabel = listItem.doseLabel;
	const takenLabel = listItem.takenLabel;
	const takenIcon = listItem.takenIcon;
	listItem.get_item().checkButton = listItem.checkButton;

	if (!listItem.controllerAdded) {
		row.add_controller(listItem.keyController);
		listItem.controllerAdded = true;
	}

	const itemTakenDate = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
	const itemTime = GLib.DateTime.new_local(1, 1, 1, item.time[0], item.time[1], 1);
	const time = itemTime.format(timeFormat);
	const timeTaken = itemTakenDate.format(timeFormat);

	nameLabel.label = item.name;
	doseLabel.label = `${item.dose} ${item.unit} • ${time}`;

	const isConfirmed = item.taken[1] === 1 || item.taken[1] === 2;
	takenIcon.set_visible(isConfirmed);

	switch (item.taken[1]) {
		case 1:
			takenLabel.label = timeTaken;
			takenIcon.icon_name = 'check-confirmed-symbolic';
			break;
		case 2:
			takenLabel.label = timeTaken;
			takenIcon.icon_name = 'check-auto-confirmed-symbolic';
			break;
		case 0:
			takenLabel.label = _('Skipped');
			break;
		case -1:
			takenLabel.label = _('Missed');
			break;
		default:
			takenLabel.label = timeTaken;
	}

	box.set_css_classes(['item-box', item.color]);
});
