/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { getSpecificDaysLabel } from './utils.js';
import { DosageApplication } from './main.js';
import { confirmDeleteDialog } from './medDialog.js';
import { openRefillDialog } from './refillDialog.js';

export const treatmentsFactory = new Gtk.SignalListItemFactory();

let delayDialog = false;

treatmentsFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box();

	listItem.altClick = new Gtk.GestureClick({ button: 3 });

	listItem.box.add_controller(listItem.altClick);

	listItem.icon = new Gtk.Image({
		margin_start: 16,
		margin_end: 6,
		icon_name: 'pill-symbolic',
	});

	listItem.box.append(listItem.icon);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 8,
		margin_end: 11,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.infoLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.infoLabel);

	listItem.durationNextDateLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		visible: false,
		margin_top: 1,
	});

	listItem.labelsBox.append(listItem.durationNextDateLabel);

	listItem.invLabelBtn = new Gtk.Button({
		css_classes: ['badge-box', 'badge-content'],
		valign: Gtk.Align.CENTER,
		margin_end: 5,
		visible: false,
		tooltip_text: _('Refill inventory'),
	});

	listItem.invLabelBtn.connect('clicked', btn => {
		if (!delayDialog) {
			openRefillDialog(listItem, listItem.get_position());
			delayDialog = true;
			setTimeout(() => {
				delayDialog = false;
			}, 500);
		}
	});

	listItem.box.append(listItem.invLabelBtn);

	listItem.optionsMenu = new Gio.Menu();

	listItem.popoverMenu = new Gtk.PopoverMenu({
		halign: Gtk.Align.START,
		has_arrow: false,
		menu_model: listItem.optionsMenu,
	});

	listItem.box.append(listItem.popoverMenu);

	listItem.optionsButton = new Gtk.MenuButton({
		tooltip_text: _('Options'),
		css_classes: ['circular'],
		valign: Gtk.Align.CENTER,
		margin_start: 5,
		margin_end: 12,
		icon_name: 'view-more-symbolic',
		menu_model: listItem.optionsMenu,
	});

	listItem.box.append(listItem.optionsButton);
	listItem.set_child(listItem.box);
});

treatmentsFactory.connect('bind', (factory, listItem) => {
	const DosageWindow = DosageApplication.get_default().activeWindow;
	const app = DosageWindow.get_application();

	const { box, nameLabel, optionsMenu, popoverMenu, icon, altClick } = listItem;
	const item = listItem.get_item().obj;
	const pos = listItem.get_position();
	const row = box.get_parent();
	const inv = item.inventory;

	// right click menu
	altClick.connect('pressed', (_gestureClick, _nPress, x, y) => {
		const position = new Gdk.Rectangle({ x: x, y: y });
		popoverMenu.pointing_to = position;
		popoverMenu.popup();
	});

	const activateItem = () => {
		const listView = row.get_parent();
		listView.emit('activate', pos);
	};

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) activateItem();
	});
	row.add_controller(keyController);

	app.remove_action(`edit${pos}`);
	app.remove_action(`refill${pos}`);
	app.remove_action(`duplicate${pos}`);
	app.remove_action(`delete${pos}`);
	optionsMenu.remove_all();

	const editAct = new Gio.SimpleAction({ name: `edit${pos}` });
	editAct.connect('activate', () => activateItem());
	app.add_action(editAct);

	if (inv.enabled) {
		const refillAct = new Gio.SimpleAction({ name: `refill${pos}` });
		refillAct.connect('activate', () => openRefillDialog(listItem, pos));
		app.add_action(refillAct);
	}

	const duplicateAct = new Gio.SimpleAction({ name: `duplicate${pos}` });
	duplicateAct.connect('activate', () => {
		const list = DosageWindow._treatmentsList;
		DosageWindow._openMedDialog(list, pos, 'duplicate');
	});
	app.add_action(duplicateAct);

	const deleteAct = new Gio.SimpleAction({ name: `delete${pos}` });
	deleteAct.connect('activate', () => confirmDeleteDialog(item, pos, DosageWindow));
	app.add_action(deleteAct);

	optionsMenu.append(_('Edit'), `app.edit${pos}`);
	optionsMenu.append(_('Refill'), `app.refill${pos}`);
	optionsMenu.append(_('Duplicate'), `app.duplicate${pos}`);
	optionsMenu.append(_('Delete'), `app.delete${pos}`);

	nameLabel.label = item.name;
	icon.icon_name = item.icon;

	setInventoryAndDateLabels(listItem);

	listItem.get_item().connect('notify::obj', () => {
		setInventoryAndDateLabels(listItem);
	});

	box.set_css_classes(['item-box', item.color]);
});

function setInventoryAndDateLabels(listItem) {
	const item = listItem.get_item().obj;
	const { infoLabel, durationNextDateLabel, invLabelBtn } = listItem;
	const today = new Date().setHours(0, 0, 0, 0);
	const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
	const end = new Date(item.duration.end).setHours(0, 0, 0, 0);
	const inv = item.inventory;

	if (inv.enabled) {
		let currInv = inv.current < 0 ? 0 : inv.current;

		invLabelBtn.set_visible(true);
		invLabelBtn.label = `${currInv} ` + _('Remaining');
		invLabelBtn.remove_css_class('low-stock');

		if (inv.current <= inv.reminder) {
			invLabelBtn.label = `${currInv} ↓ ` + _('Low stock');
			invLabelBtn.add_css_class('low-stock');
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
		case 'day-of-month':
			infoLabel.label = _('Day') + `: ${item.monthDay}`;
			break;
		case 'cycle':
			const nextDt = new Date(item.cycleNextDate).setHours(0, 0, 0, 0);
			const nextDate = formatDate(nextDt);

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

			infoLabel.label = `${_('Cycle')} • ${item.cycle[0]} ⊷ ${item.cycle[1]}`;
			break;
		case 'when-needed':
			infoLabel.label = _('When necessary');
			break;
	}

	if (item.notes !== '') infoLabel.label += ` • ${item.notes}`;

	if (item.duration.enabled && (end < today || end < start)) {
		durationNextDateLabel.label = endedLabel;
	}
}

function formatDate(dt) {
	const date = GLib.DateTime.new_from_unix_local(dt / 1000);
	return date.format('%x');
}
