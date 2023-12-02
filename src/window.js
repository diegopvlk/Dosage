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
import Pango from 'gi://Pango';

import { Medication, HistoryMedication, TodayMedication } from './medication.js';
import { todayHeaderFactory, todayItemFactory } from './todayFactory.js';
import { historyHeaderFactory, historyItemFactory } from './historyFactory.js';
import { treatmentsFactory } from './treatmentsFactory.js';
import openMedicationWindow from './medWindow.js';

import {
	HistorySorter,
	HistorySectionSorter,
	TodaySectionSorter,
	DataDir,
	addLeadZero,
	createTempFile,
	isTodayMedDay,
	datesPassedDiff,
} from './utils.js';

export const historyLS = Gio.ListStore.new(HistoryMedication);
export const treatmentsLS = Gio.ListStore.new(Medication);

export const DosageWindow = GObject.registerClass({
	GTypeName: 'DosageWindow',
	Template: 'resource:///io/github/diegopvlk/Dosage/ui/window.ui',
	InternalChildren: [
		'todayList',
		'historyList',
		'treatmentsList',
		'treatmentsPage',
		'emptyTodayBox',
		'emptyToday',
		'emptyHistory',
		'emptyTreatments',
		'allDoneIcon',
		'skipBtn',
		'entryBtn',
		'unselectBtn',
	],
},
class DosageWindow extends Adw.ApplicationWindow {
	constructor(application) {
		super({ application });
		this.#loadSettings();
		this.#checkClockFormat();
		this.#start();
		this.#checkInventory();
		this.#clockTick();
	}

	#loadSettings() {
		const appId = this.get_application().get_application_id();
		globalThis.settings = new Gio.Settings({ schemaId: appId });
		settings.bind('window-width', this, 'default-width', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('window-height', this, 'default-height', Gio.SettingsBindFlags.DEFAULT);
	}

	#checkClockFormat() {
		const currentTime = GLib.DateTime.new_now_local();
		const timeFormat = currentTime.format('%X').slice(-2);
		globalThis.clockIs12 = timeFormat === 'AM' || timeFormat === 'PM';
	}

	#start() {
		const treatmentsFile = DataDir.get_child('dosage-treatments.json');
		const historyFile = DataDir.get_child('dosage-history.json');

		try {
			this._createOrLoadJson('treatments', treatmentsFile);
			this._createOrLoadJson('history', historyFile);
			this._updateItems();
			this._addMissedItems();
			this._updateCycleAndLastUp();
			this._updateJsonFile('treatments', treatmentsLS);
			this._loadToday();
			this._handleSuspension();
			this._scheduleNotifications();
		} catch (err) {
			console.error('Error loading treatments/history/today:', err);
		}
	}

	#checkInventory(notifAction) {
		this._treatmentsPage.set_needs_attention(false);
		this._treatmentsPage.badge_number = 0;

		for (const item of treatmentsLS) {
			const inv = item.info.inventory;
			if (inv.enabled && inv.current <= inv.reminder) {
				this._treatmentsPage.set_needs_attention(true);
				this._treatmentsPage.badge_number += 1;

				if (!this.get_visible() && !notifAction) {
					const [notification, app] = this._getNotification();
					// TRANSLATORS: Notification text for when the inventory is low
					notification.set_body(_('You have treatments low in stock'));
					app.send_notification('low-stock', notification);
					break;
				}
			}
		}

		// reload-ish of treatments list
		// necessary for updating low stock label
		this._treatmentsList.model = new Gtk.NoSelection({
			model: treatmentsLS,
		});
	}

	#clockTick() {
		let lastDate = new Date().setHours(0, 0, 0, 0);

		const tick = () => {
			const now = new Date().setHours(0, 0, 0, 0);
			// update everything at next midnight
			if (now > lastDate) {
				this._addMissedItems();
				this._updateEverything();
				this._scheduleNotifications();
				lastDate = now;
			}
		}

		setInterval(tick, 2500);
	}

	_handleSuspension() {
		const onWakingUp = () => this._scheduleNotifications('sleep');
		const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
		connection.signal_subscribe(
			'org.freedesktop.login1',
			'org.freedesktop.login1.Manager',
			'PrepareForSleep',
			'/org/freedesktop/login1',
			null,
			Gio.DBusSignalFlags.NONE,
			onWakingUp
		);
	}

	_createOrLoadJson(fileType, file) {
		const filePath = file.get_path();

		if (!file.query_exists(null)) {
			try {
				this._createNewFile(filePath);
				log(`New ${fileType} file created at: ${filePath}`);
			} catch (err) {
				console.error(`Failed to create new ${fileType} file: ${err}`);
			}
		}

		this._loadJsonContents(fileType, filePath);
	}

	_createNewFile(filePath) {
		const file = Gio.File.new_for_path(filePath);
		const flags = Gio.FileCreateFlags.NONE;
		const fileStream = file.create(flags, null);

		if (!fileStream) {
			throw new Error('Failed to create the file:', filePath);
		}

		const outputStream = new Gio.DataOutputStream({ base_stream: fileStream });
		outputStream.put_string('{"meds":[]}', null);

		outputStream.close(null);
		fileStream.close(null);
	}

	_loadJsonContents(fileType, filePath) {
		const file = Gio.File.new_for_path(filePath);
		const decoder = new TextDecoder('utf8');

		try {
			let [success, contents, length] = file.load_contents(null);

			if (success) {
				const contentString = decoder.decode(contents);
				if (fileType === 'treatments') {
					this._loadTreatments(JSON.parse(contentString))
				} else if (fileType === 'history') {
					this._loadHistory(JSON.parse(contentString))
				}
			} else {
				log('Failed to read file contents.');
			}
		} catch (err) {
			console.error(`Error reading the file ${fileType}: ${err.message}`);
		}
	}

	_loadTreatments(treatmentsJson) {
		try {
			if (treatmentsLS.get_n_items() === 0) {
				treatmentsJson.meds.forEach(med => {
					treatmentsLS.insert_sorted(
						new Medication({
							// expression is for <= v1.2.0
							name: med.name || med._name,
							unit: med.unit || med._unit,
							info: med.info || med._info,
						}),
						(obj1, obj2) => {
							const name1 = obj1.name;
							const name2 = obj2.name;
							return name1.localeCompare(name2);
						}
					);
				});

				this._treatmentsList.set_factory(treatmentsFactory);
				this._treatmentsList.remove_css_class('view');
				this._treatmentsList.add_css_class('background');

				this._treatmentsList.model = new Gtk.NoSelection({
					model: treatmentsLS,
				});
			}
		} catch (err) {
			console.error('Error loading treatments:', err);
		}
	}

	_loadHistory(historyJson) {
		try {
			if (historyLS.get_n_items() === 0) {
				historyJson.meds.forEach(med => {
					historyLS.append(
						new HistoryMedication({
							// expression is for <= v1.2.0
							name: med.name || med._name,
							unit: med.unit || med._unit,
							color: med.color || med._color,
							info: med.info || med._info,
							taken: med.taken || med._taken,
							date: med.date || med._date,
						})
					);
				});

				this.sortedHistoryModel = new Gtk.SortListModel({
					model: historyLS,
					section_sorter: new HistorySectionSorter(),
					sorter: new HistorySorter(),
				});

				this._historyList.model = new Gtk.NoSelection({
					model: this.sortedHistoryModel,
				});

				this._historyList.remove_css_class('view');
				this._historyList.add_css_class('background');
				this._historyList.set_header_factory(historyHeaderFactory);
				this._historyList.set_factory(historyItemFactory);

				historyLS.connect('items-changed', (model, pos, removed, added) => {
					if (added) {
						const itemAdded = model.get_item(pos);
						for (const item of treatmentsLS) {
							const sameItem = 
								item.name === itemAdded.name &&
								item.info.inventory.enabled &&
								itemAdded.taken === 'yes';

							if (sameItem) {
								item.info.inventory.current -= itemAdded.info.dose;
							}
						}
					}

					if (removed) {
						const removedDt = new Date(removedItem.date);
						const date = removedDt.setHours(0, 0, 0, 0);
						const today = new Date().setHours(0, 0, 0, 0);

						if (date === today) {
							for (const item of treatmentsLS) {
								const sameItem = item.name === removedItem.name;
								const info = item.info;

								if (sameItem) {
									info.dosage.forEach((timeDose) => {
										for (const i of this.todayLS) {
											const sameName = 
												item.name === removedItem.name;
											const sameTime =
												String(i.info.dosage.time) ===
												String(removedItem.info.time);

											// update lastTaken when removing an item
											// with the same name, time and date of today items
											if (sameName && sameTime) {
												timeDose.lastTaken = null;
											}
										}
									});

									if (info.inventory.enabled && removedItem.taken === 'yes') {
										info.inventory.current += removedItem.info.dose;
									}
								}
							}
						}
						this._updateEverything();
						this._scheduleNotifications('removing');
					}
				});
			}
		} catch (err) {
			console.error('Error loading history:', err);
		}

		this._setEmptyHistLabel();
		this._emptyHistory.ellipsize = Pango.EllipsizeMode.END;
	}

	_loadToday() {
		this.todayLS = Gio.ListStore.new(TodayMedication);
		const tempFile = createTempFile('treatments', treatmentsLS);

		tempFile.meds.forEach(med => {
			med.info.dosage.forEach(timeDose => {
				const info = { ...med.info };
				info.dosage = {
					time: [timeDose.time[0], timeDose.time[1]],
					dose: timeDose.dose,
				};
				this.todayLS.append(
					new TodayMedication({
						name: med.name,
						unit: med.unit,
						info: info,
					})
				);
			});
		})

		const filterTodayModel = new Gtk.FilterListModel({
			model: this.todayLS,
			filter: Gtk.CustomFilter.new(item => {
				return isTodayMedDay(
					item,
					this._historyList.model,
				);
			}),
		});

		const sortedTodayModel = new Gtk.SortListModel({
			model: filterTodayModel,
			section_sorter: new TodaySectionSorter(),
		});

		this.todayItems = [];
		this.todayModel = new Gtk.NoSelection({ model: sortedTodayModel });

		this._todayList.model = this.todayModel;
		this._todayList.remove_css_class('view');
		this._todayList.add_css_class('background');
		this._todayList.set_header_factory(todayHeaderFactory);
		this._todayList.set_factory(todayItemFactory);

		const noItems = sortedTodayModel.get_n_items() === 0;
		const noTreatments = this._treatmentsList.model.get_n_items() === 0;

		this._emptyTreatments.ellipsize = Pango.EllipsizeMode.END;
		this._emptyToday.ellipsize = Pango.EllipsizeMode.END;
		
		this._emptyTreatments.set_visible(noTreatments);

		if (noItems && noTreatments) {
			this._emptyTodayBox.set_visible(true);
			this._emptyToday.set_visible(true);
			this._allDoneIcon.set_visible(false);
			this._emptyToday.label = _('No treatments added yet');
		} else if (noItems) {
			this._emptyTodayBox.set_visible(true);
			this._allDoneIcon.set_visible(true);
			this._emptyToday.set_visible(true);
			this._emptyToday.label = _('All done for today');
		} else {
			this._emptyTodayBox.set_visible(false);
			this._allDoneIcon.set_visible(false);
			this._emptyToday.set_visible(false);
		}
	}

	_scheduleNotifications(action) {
		for (const id in this.scheduledItems) {
			clearTimeout(this.scheduledItems[id]);
		}

		this.scheduledItems = {};
		
		const todayLength = this.todayModel.get_n_items();
		
		for (let i = 0; i < todayLength; i++) {
			this._addToBeNotified(this.todayModel.get_item(i), action);
		}
	}

	_addToBeNotified(item, action) {
		const info = item.info;
		const now = new Date();
		const hours = now.getHours();
		const minutes = now.getMinutes();
		const seconds = now.getSeconds();
		const itemHour = info.dosage.time[0];
		const itemMin = info.dosage.time[1];

		// milliseconds
		let timeDiff =
			(itemHour - hours) * 3600000 +
			(itemMin - minutes) * 60000 -
			seconds * 1000;

		let pseudoId = JSON.stringify({
			name: item.name, dosage: item.info.dosage,
		});
		// remove accents and special characters
		pseudoId = pseudoId.normalize('NFKD').replace(/[^0-9A-Za-z]/g, '');

		const notify = () => {
			// notifications from the past will be sent again instantly (setTimeout is < 0)
			// when performing some action like saving/adding/updating/removing
			// because it needs to be rescheduled at every action
			// so don't send notifications in this case
			if (action && action != 'sleep' && timeDiff < 0) {
				// timeDiff = 0;
				return;
			};

			const [notification, app] = this._getNotification();
			let h = info.dosage.time[0];
			let m = info.dosage.time[1];
			let period = '';

			if (clockIs12) {
				period = ' AM';
				if (h >= 12) period = ' PM';
				if (h > 12) h -= 12;
				if (h === 0) h = 12;
			}

			notification.set_title(item.name);
			notification.set_body(
				`${item.info.dosage.dose} ${item.unit}  •  ` +
					`${addLeadZero(h)}∶${addLeadZero(m)}` + period
			);

			if (settings.get_boolean('confirm-button')) {
				notification.add_button(_('Confirm'), `app.confirm${pseudoId}`);
			}

			if (settings.get_boolean('skip-button')) {
				notification.add_button(_('Skip'), `app.skip${pseudoId}`);
			}

			const confirmAction = new Gio.SimpleAction({
				name: `confirm${pseudoId}`,
			});
			confirmAction.connect('activate', () =>
				this._addNotifItemToHistory(item, 'yes')
			);

			const skipAction = new Gio.SimpleAction({ name: `skip${pseudoId}` });
			skipAction.connect('activate', () =>
				this._addNotifItemToHistory(item, 'no')
			);

			app.add_action(confirmAction);
			app.add_action(skipAction);

			if (settings.get_boolean('sound') && action != 'sleep') {
				const ding = Gio.File.new_for_uri(
					'resource:///io/github/diegopvlk/Dosage/sounds/ding.ogg'
				);
				const mediaFile = Gtk.MediaFile.new_for_file(ding);
				mediaFile.play();
			}

			app.send_notification(pseudoId, notification);
		}

		// v1.1.0 only has recurring: boolean
		const recurringEnabled = info.recurring?.enabled || info.recurring === true;

		if (recurringEnabled) {
			const interval = info.recurring.interval || 5;
			const minutes = interval * 60 * 1000;
			const recurringNotify = (pseudoId, timeDiff) => {
				this.scheduledItems[pseudoId] = setTimeout(() => {
					notify();
					recurringNotify(pseudoId, minutes);
				}, timeDiff);
			};

			recurringNotify(pseudoId, timeDiff);
			return;
		}

		this.scheduledItems[pseudoId] = setTimeout(notify, timeDiff);
	}

	_getNotification() {
		const app = this.get_application();
		const notification = new Gio.Notification();
		const openAction = new Gio.SimpleAction({ name: 'open' });

		notification.set_default_action('app.open');
		openAction.connect('activate', () => {
			app.activate();
			this.present();
		});
		app.add_action(openAction);

		const priorityState = settings.get_boolean('priority');
		const priority = priorityState
			? Gio.NotificationPriority.URGENT
			: Gio.NotificationPriority.NORMAL;
		notification.set_priority(priority);
		notification.set_title(_('Dosage'));

		return [notification, app];
	}

	_selectTodayItems(list, position) {
		const model = list.get_model();

		let rowItemPos = 0;
		let currentRow = list.get_first_child();

		while (currentRow) {
			if (currentRow.get_name() === 'GtkListItemWidget') {
				if (position === rowItemPos) {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					const item = model.get_item(position);
					const index = this.todayItems.lastIndexOf(item);

					if (check.get_active() === false) {
						this.todayItems.push(item);
					} else {
						this.todayItems.splice(index, 1);
					}

					check.set_active(!check.get_active());
				}
				rowItemPos++;
			}
			currentRow = currentRow.get_next_sibling();
		}

		this._unselectBtn.connect('clicked', () => {
			let currentRow = list.get_first_child();

			while (currentRow) {
				if (currentRow.get_name() === 'GtkListItemWidget') {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					check.set_active(false);
				}
				currentRow = currentRow.get_next_sibling();
			}
			this._updateEntryBtn(false);
		});

		const hasTodayItems = this.todayItems.length > 0;
		this._updateEntryBtn(hasTodayItems);
	}

	_updateEntryBtn(hasTodayItems) {
		this._entryBtn.label = hasTodayItems ? _('Confirm') : _('One-time entry');
		this._skipBtn.set_visible(hasTodayItems);
		this._unselectBtn.set_visible(hasTodayItems);

		if (hasTodayItems) {
			this._entryBtn.add_css_class('suggested-action');
		} else {
			this._entryBtn.remove_css_class('suggested-action');
			this.todayItems = [];
		}
	}

	_addTodayToHistory(btn) {
		const taken = btn.get_name(); // yes or no

		if (this.todayItems.length > 0) {
			this.todayItems.forEach(item => 
				this._insertItemToHistory(item, taken)
			);

			this._updateEverything();
			this._scheduleNotifications('adding');
		} else {
			// one-time entry
			this._openMedWindow(null, null, true);
		}

		this._updateEntryBtn(false);
	}

	_addNotifItemToHistory(item, taken) {
		const todayLength = this.todayModel.get_n_items();
		// only insert to history if item is not in today list
		for (let i = 0; i < todayLength; i++) {
			if (item === this.todayModel.get_item(i)) {
				this._insertItemToHistory(item, taken);
				this._updateEverything(null, 'notifAction');
				this._scheduleNotifications('adding');
			}
		}
	}

	_insertItemToHistory(item, taken, missedDate) {
		historyLS.insert(
			0,
			new HistoryMedication({
				name: item.name,
				unit: item.unit,
				color: item.info.color,
				taken: taken,
				info: item.info.dosage,
				date: missedDate || new Date().toISOString(),
			})
		);

		// update lastTaken of treatment dose when confirming/skipping
		if (!missedDate) {
			for (const item of treatmentsLS) {
				item.info.dosage.forEach(timeDose => {
					const tempObj = { ...timeDose, lastTaken: undefined };
					const treatDose = JSON.stringify(tempObj);

					this.todayItems.forEach(i => {
						const todayDose = JSON.stringify(i.info.dosage);
						if (treatDose === todayDose && i.name === item.name) {
							timeDose.lastTaken = new Date().toISOString();
						}
					});
				});
			}
		}
	}

	_updateJsonFile(type, listStore) {
		const fileName = `dosage-${type}.json`;
		const file = DataDir.get_child(fileName);
		const tempFile = createTempFile(type, listStore);

		const updateFile = () => {
			return new Promise((resolve, reject) => {
				const byteArray = new TextEncoder().encode(JSON.stringify(tempFile));
				file.replace_contents_async(
					GLib.Bytes.new(byteArray),
					null,
					true,
					Gio.FileCreateFlags.REPLACE_DESTINATION,
					null,
					(file, result, userData) => {
						try {
							file.replace_contents_finish(result);
							resolve(`${fileName} updated`);
						} catch (err) {
							console.error(`Update of ${fileName} failed: ${err}`);
							reject(err);
						}
					},
					null
				);
			});
		};

		updateFile()
			.then(result => log(result))
			.catch(err => console.error('Update failed:', err));
	}

	_updateItems() {
		// for compatibility
		for (const item of treatmentsLS) {
			const info = item.info;
			const dur = info.duration;

			// change to int and to parse in ms instead of seconds
			if (typeof dur.start === 'string') {
				dur.start = +dur.start * 1000;
				// add duration.end if doesn't exist
				dur.end = +dur.end * 1000 || dur.start;
			}

			if (!info.lastUpdate) {
				info.lastUpdate = new Date().toISOString();
			}
		}
	}

	_addMissedItems() {
		let itemsAdded = false;

		const insert = (timeDose, tempItem, nextDate) => {
			if (!timeDose.lastTaken) {
				const nextDt = new Date(nextDate);
				nextDt.setHours(23, 59, 59, 999);
				this._insertItemToHistory(tempItem, 'miss', nextDt.toISOString());
				itemsAdded = true;
			}
		}

		for (const item of treatmentsLS) {
			const info = item.info;
			const today = new Date();
			const nextDate = new Date(item.info.lastUpdate);
			today.setHours(0, 0, 0, 0);
			nextDate.setHours(0, 0, 0, 0);

			let current = info.cycle[2];
			
			while (nextDate < today) {
				const [active, inactive] = info.cycle;

				info.dosage.forEach(timeDose => {
					const tempItem = {};
					tempItem.name = item.name;
					tempItem.unit = item.unit;
					tempItem.info = { ...item.info };
					tempItem.info.dosage = {
						time: [timeDose.time[0], timeDose.time[1]],
						dose: timeDose.dose,
					};
					switch (info.frequency) {
						case 'daily':
							insert(timeDose, tempItem, nextDate);
							break;
						case 'specific-days':
							if (info.days.includes(nextDate.getDay())) {
								insert(timeDose, tempItem, nextDate);
							}
							break;
						case 'cycle':
							if (current <= active) {
								insert(timeDose, tempItem, nextDate);
							}
							break;
					}
					// only the first date of confirmed/skipped items doens't get added 
					// so set lastTaken to null after the first loop
					timeDose.lastTaken = null;
				});

				current += 1;
				if (current > active + inactive) current = 1;
				
				nextDate.setDate(nextDate.getDate() + 1);
			}
		}

		if (itemsAdded) {
			this._updateJsonFile('history', historyLS);
		}

		this._setEmptyHistLabel();
	}

	_updateCycleAndLastUp() {
		for (const item of treatmentsLS) {
			const info = item.info;
			const lastUpdate = new Date(info.lastUpdate);
			const lastUp = lastUpdate.setHours(0, 0, 0, 0);
			const start = new Date(info.duration.start).setHours(0, 0, 0, 0);
			const today = new Date().setHours(0, 0, 0, 0);

			function findDate(start) {
				let nextDtStr;
				let curr = info.cycle[2];
				let nextDate = start ? new Date(start) : new Date();
				nextDate.setHours(0, 0, 0, 0);

				while (true) {
					nextDtStr = nextDate.toISOString();
					const [active, inactive] = info.cycle;
					if (curr <= active) break;
					curr += 1;
					if (curr > active + inactive) curr = 1;
					nextDate.setDate(nextDate.getDate() + 1);
				}

				return nextDtStr;
			}
			
			if (info.frequency == 'cycle') {
				if (start < today) {
					const datesPassed = datesPassedDiff(lastUpdate, new Date());
					let [active, inactive, current] = info.cycle;

					for (let i = 0; i < datesPassed.length; i++) {
						current += 1;
						if (current > active + inactive) current = 1;
					}

					item.info.cycle[2] = current;
					item.info.cycleNextDate = findDate();
				} else {
					item.info.cycleNextDate = findDate(info.duration.start);
				}
			}

			if (lastUp < today) info.lastUpdate = new Date().toISOString();
		}
	}

	_setEmptyHistLabel() {
		if (historyLS.get_n_items() === 0)
			this._emptyHistory.set_visible(true);
		else
			this._emptyHistory.set_visible(false);
	}

	_updateEverything(skipHistUp, notifAction) {
		if (!skipHistUp) this._updateJsonFile('history', historyLS);
		this._updateCycleAndLastUp();
		this._updateJsonFile('treatments', treatmentsLS);
		this._loadToday();
		this._setEmptyHistLabel();
		this._updateEntryBtn(false);
		this.#checkInventory(notifAction);
	}

	_openMedWindow(list, position, oneTime) {
		openMedicationWindow(this, list, position, oneTime);
	}
});
