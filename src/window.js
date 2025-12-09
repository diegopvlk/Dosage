/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { MedicationObject } from './medication.js';
import { todayHeaderFactory, todayItemFactory } from './todayFactory.js';
import { historyHeaderFactory, historyItemFactory } from './historyFactory.js';
import { treatmentsFactory } from './treatmentsFactory.js';
import { openEditHistDialog } from './editHistDialog.js';
import { openMedicationDialog } from './medDialog.js';
import { openOneTimeDialog } from './oneTimeDialog.js';
import upgradeItems from './upgradeItems.js';

import {
	HistorySectionSorter,
	TodaySectionSorter,
	DataDir,
	createTempObj,
	isTodayMedDay,
	datesPassedDiff,
	timeFormat,
	isValidTreatmentItem,
	isValidHistoryItem,
} from './utils.js';
import { sortTreatFunc } from './treatmentsSorter.js';

export const historyLS = Gio.ListStore.new(MedicationObject);
export const treatmentsLS = Gio.ListStore.new(MedicationObject);

export const DosageWindow = GObject.registerClass(
	{
		GTypeName: 'DosageWindow',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/window.ui',
		InternalChildren: [
			'todayList',
			'toggleHistAmountBtn',
			'removeHistItemsBtn',
			'unselectHistItemsBtn',
			'historyList',
			'treatmentsList',
			'treatmentsPage',
			'buttonTreatmentsSorter',
			'emptyToday',
			'emptyHistory',
			'emptyTreatments',
			'spinnerToday',
			'skipBtn',
			'entryBtn',
			'unselectBtn',
			'viewStack',
			'btnWhenNeeded',
			'buttonSearch',
			'searchBar',
			'searchEntry',
		],
	},
	class DosageWindow extends Adw.ApplicationWindow {
		constructor(application) {
			super({ application });
			this.#loadSettings();
			this.#start();
			this.#clockTick();
		}

		#loadSettings() {
			this.app = this.get_application();
			settings.bind('window-width', this, 'default-width', Gio.SettingsBindFlags.DEFAULT);
			settings.bind('window-height', this, 'default-height', Gio.SettingsBindFlags.DEFAULT);
			settings.connect('changed::clear-old-hist', (sett, key) => {
				if (sett.get_boolean(key) === true) {
					this.clearOldHistoryEntries();
					this.setShowHistoryAmount();
					this.updateJsonFile('history', historyLS);
				}
			});
		}

		#start() {
			const load = () => {
				this.loadData();
				this.withdrawPastNotifications();
				this.updateCycleAndLastUp();
				this.updateJsonFile('treatments', treatmentsLS);
				this.loadToday();
				this._spinnerToday.set_visible(false);
				this.handleSuspension();
				this.scheduleNotifications();
				this.checkInventory();
			};

			const loadPromise = new Promise((resolve, reject) => resolve());
			loadPromise.then(_ => {
				setTimeout(() => load(), 100);
			});
		}

		withdrawPastNotifications() {
			// these are from the closed app
			// meaning the actions doesn't work, so remove then

			const prevDate = new Date(this.lastUpdate);
			prevDate.setDate(prevDate.getDate() - 1);

			for (const it of treatmentsLS) {
				const item = it.obj;
				for (const timeDose of item.dosage) {
					const currentDate = new Date();

					while (currentDate > prevDate) {
						const dateKey = currentDate.setHours(timeDose.time[0], timeDose.time[1], 0, 0);
						this.app.withdraw_notification(String(dateKey));
						currentDate.setDate(currentDate.getDate() - 1);
					}
				}
			}
		}

		loadData() {
			const treatmentsFile = DataDir.get_child('dosage-treatments.json');
			const historyFile = DataDir.get_child('dosage-history.json');

			this.createOrLoadJson('treatments', treatmentsFile);
			this.createOrLoadJson('history', historyFile);
			if (this.addMissedItems() | this.clearOldHistoryEntries()) {
				this.updateJsonFile('history', historyLS);
			}
		}

		checkInventory(isNotifAction) {
			this._treatmentsPage.set_needs_attention(false);
			this._treatmentsPage.badge_number = 0;
			let notify = false;

			for (const it of treatmentsLS) {
				const item = it.obj;
				const whenNeeded = item.frequency === 'when-needed';
				const today = new Date().setHours(0, 0, 0, 0);
				const end = new Date(item.duration.end).setHours(0, 0, 0, 0);
				const ended = item.duration.enabled && end < today;
				const inv = item.inventory;

				if (inv.enabled && inv.current <= inv.reminder) {
					this._treatmentsPage.set_needs_attention(true);
					this._treatmentsPage.badge_number += 1;
					if (!notify) notify = !ended && !whenNeeded;
				}
			}

			if (!settings.get_boolean('low-stock-notif')) return;

			const [notification, app] = this.getNotification();

			const icon = Gio.ThemedIcon.new_from_names([
				'emblem-important-symbolic',
				'dialog-information-symbolic',
			]);

			notification.set_icon(icon);

			app.withdraw_notification('low-stock');

			if (!this.get_visible() && !isNotifAction && notify) {
				notification.set_title(_('Reminder'));
				// TRANSLATORS: Notification text for when the inventory is low
				notification.set_body(_('You have treatments low in stock'));
				app.send_notification('low-stock', notification);
			}
		}

		#clockTick() {
			this.today = new Date();
			let lastDate = new Date().setHours(0, 0, 0, 0);

			const tick = () => {
				const now = new Date().setHours(0, 0, 0, 0);
				// update everything at next midnight
				if (now > lastDate) {
					this.clearOldHistoryEntries();
					this.addMissedItems();
					this.updateEverything();
					this.scrollHistToTop();
					this.scheduleNotifications();
					lastDate = now;
				}
			};

			setInterval(tick, 2500);
		}

		handleSuspension() {
			const onWakingUp = () => this.scheduleNotifications('sleep');
			this._connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
			this._connection.signal_subscribe(
				'org.freedesktop.login1',
				'org.freedesktop.login1.Manager',
				'PrepareForSleep',
				'/org/freedesktop/login1',
				null,
				Gio.DBusSignalFlags.NONE,
				onWakingUp,
			);
		}

		createOrLoadJson(fileType, file) {
			const filePath = file.get_path();

			if (!file.query_exists(null)) {
				try {
					this.createNewFile(filePath, fileType);
					log(`New ${fileType} file created at: ${filePath}`);
				} catch (err) {
					console.error(`Failed to create new ${fileType} file: ${err}`);
				}
			}

			this.loadJsonContents(fileType, filePath);
		}

		createNewFile(filePath, fileType) {
			const file = Gio.File.new_for_path(filePath);
			const flags = Gio.FileCreateFlags.NONE;
			const fileStream = file.create(flags, null);

			if (!fileStream) {
				throw new Error('Failed to create the file:', filePath);
			}

			const outputStream = new Gio.DataOutputStream({
				base_stream: fileStream,
			});

			if (fileType === 'treatments') {
				this.lastUpdate = new Date().toISOString();
				outputStream.put_string(`{ "treatments": [], "lastUpdate": "${this.lastUpdate}" }`, null);
			} else if (fileType === 'history') {
				outputStream.put_string('{ "history": {} }', null);
			}

			outputStream.close(null);
			fileStream.close(null);
		}

		loadJsonContents(fileType, filePath) {
			const file = Gio.File.new_for_path(filePath);
			const decoder = new TextDecoder('utf8');

			this.errDialog = new Adw.AlertDialog({
				heading: _('An Issue Has Occurred'),
			});

			try {
				const [success, contents] = file.load_contents(null);
				if (!success) {
					const errStr = 'Failed to read file contents.';
					this.errDialog.body = errStr;
					this.errDialog.add_response('close', _('Close'));
					this.errDialog.present(this);
					console.error(errStr);
					return;
				}

				let allValid = false;
				const contentString = decoder.decode(contents);
				const json = JSON.parse(contentString);

				switch (fileType) {
					case 'treatments':
						const upgradedTreatments = upgradeItems(json, fileType);
						const treatData = upgradedTreatments || json;

						try {
							for (const it of treatData.treatments) {
								allValid = isValidTreatmentItem(it);
								if (!allValid) break;
							}
						} catch (err) {
							this.errDialog.body = err;
							this.errDialog.add_response('close', _('Close'));
							this.errDialog.present(this);
							console.error(err);
							return;
						}

						this.loadTreatments(treatData);
						this.lastUpdate = treatData.lastUpdate;
						this.treatmentsVersion = treatData.version;

						return;
					case 'history':
						const upgradedHistory = upgradeItems(json, fileType);
						const histData = upgradedHistory || json;

						try {
							for (const it of histData.history) {
								allValid = isValidHistoryItem(it);
								if (!allValid) break;
							}
						} catch (err) {
							this.errDialog.body = err;
							this.errDialog.add_response('close', _('Close'));
							this.errDialog.present(this);
							console.error(err);
							return;
						}

						this.historyVersion = histData.version;
						this.loadHistory(upgradedHistory || histData);

						if (upgradedHistory) {
							this.updateJsonFile('history', historyLS);
						}

						return;
				}
			} catch (err) {
				const errStr = `Error reading ${fileType} file.`;
				this.errDialog.body = errStr;
				this.errDialog.add_response('close', _('Close'));
				this.errDialog.present(this);
				console.error(errStr, err);
			}
		}

		loadTreatments(treatmentsJson) {
			try {
				if (treatmentsLS.get_n_items() === 0) {
					treatmentsJson.treatments.forEach(med => {
						treatmentsLS.insert_sorted(
							new MedicationObject({
								obj: {
									name: med.name,
									unit: med.unit,
									notes: med.notes,
									frequency: med.frequency,
									color: med.color,
									icon: med.icon,
									days: med.days,
									monthDay: med.monthDay,
									cycle: med.cycle,
									dosage: med.dosage,
									notification: med.notification,
									inventory: med.inventory,
									duration: med.duration,
									cycleNextDate: med.cycleNextDate,
									markConfirmed: med.markConfirmed,
								},
							}),
							sortTreatFunc(settings.get_string('treatments-sorting')),
						);
					});

					this._treatmentsList.set_factory(treatmentsFactory);
					this._treatmentsList.remove_css_class('view');
					this._treatmentsList.add_css_class('background');

					this._treatmentsList.model = new Gtk.NoSelection({
						model: treatmentsLS,
					});

					const keyController = new Gtk.EventControllerKey();
					const entry = new Gtk.Entry();
					this.add_controller(keyController);

					// press letter to jump to first item with the same letter
					keyController.connect('key-pressed', (_, keyval, keycode, state) => {
						if (this._viewStack.visible_child_name !== 'treatments-page') return;

						const unicodeChar = Gdk.keyval_to_unicode(keyval);
						const keyName = String.fromCharCode(unicodeChar);

						if (unicodeChar && keyName) {
							entry.text += keyName;

							for (const it of treatmentsLS) {
								const name = it.obj.name;
								const entryTxt = entry.text.toLowerCase();
								const nameMatch = name.toLowerCase().startsWith(entryTxt);
								if (nameMatch) {
									const pos = treatmentsLS.find(it)[1];
									this._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
									entry.set_text('');
									return;
								}
							}

							entry.set_text('');
						}
					});
				}
			} catch (err) {
				console.error('Error loading treatments:', err);
				this.errorLoading = true;
			}
		}

		removeHistItems() {
			const today = new Date().setHours(0, 0, 0, 0);

			const positionsToRm = [];

			for (const item of this.histItemsToRm) {
				const position = historyLS.find(item)[1];
				positionsToRm.push(position);

				const itemRm = item.obj;
				const removedDt = new Date(itemRm.taken[0]);
				const date = removedDt.setHours(0, 0, 0, 0);

				if (date !== today) continue;

				for (const it of treatmentsLS) {
					const item = it.obj;
					const sameItem = item.name === itemRm.name;
					if (sameItem) {
						item.dosage.forEach(timeDose => {
							const sameName = item.name === itemRm.name;
							const sameTime = String(timeDose.time) === String(itemRm.time);
							// update lastTaken when removing an item
							// with the same name, time and date of today item
							if (sameName && sameTime) {
								timeDose.lastTaken = null;
							}
						});

						const updateInv =
							item.inventory.enabled && (itemRm.taken[1] === 1 || itemRm.taken[1] === 2);

						if (updateInv) {
							item.inventory.current += itemRm.dose;
						}

						// trigger signal to update labels
						it.notify('obj');
						break;
					}
				}
			}

			// important for performance and removing in the right order (descending)
			positionsToRm.sort((a, b) => b - a);

			for (const position of positionsToRm) {
				historyLS.splice(position, 1, []);
			}

			this.unselectHistItems();
			this.updateEverything({ skipCycleUp: true, histIsEmpty: historyLS.n_items === 0 });
			this.scheduleNotifications('removing');
		}

		unselectHistItems() {
			this.histMultiSelect.unselect_all();
			this.histItemsToRm.length = 0;
			this._removeHistItemsBtn.visible = false;
			this._unselectHistItemsBtn.visible = false;
			this._toggleHistAmountBtn.visible = this.histMoreThan7Sect && !this.histQuery;
		}

		histHasMoreThan7Sect() {
			const dates = new Set();
			const itemDate = new Date();

			for (const it of historyLS) {
				itemDate.setTime(it.obj.taken[0]);
				const date = itemDate.setHours(0, 0, 0, 0);

				if (!dates.has(date)) dates.add(date);

				if (dates.size > 7) return true;
			}
		}

		setShowHistoryAmount() {
			if (this.histQuery) return;

			this.unselectHistItems();

			const moreThan7Sect = this.histMoreThan7Sect;

			this._toggleHistAmountBtn.visible = moreThan7Sect;
			this._toggleHistAmountBtn.label = _('Show All');

			if (moreThan7Sect) {
				this._historyList.remove_css_class('list-no-extra-padding-bottom');
			} else {
				this._historyList.add_css_class('list-no-extra-padding-bottom');
			}

			if (!this.showAllHist && moreThan7Sect) {
				const dates = new Set();
				const itemDate = new Date();

				this.historyFilter.set_filter_func(item => {
					itemDate.setTime(item.obj.taken[0]);
					const date = itemDate.setHours(0, 0, 0, 0);

					if (!dates.has(date)) {
						dates.add(date);
					}

					return dates.size <= 7;
				});
			} else if (this.showAllHist) {
				this._toggleHistAmountBtn.label = _('Show Less');
				this.historyFilter.set_filter_func(null);
			} else {
				this._toggleHistAmountBtn.visible = false;
				this.historyFilter.set_filter_func(null);
			}
		}

		toggleHistoryAmount() {
			this.showAllHist = !this.showAllHist;
			this.setShowHistoryAmount();
		}

		async loadHistory(historyJson) {
			try {
				if (!historyLS.get_item(0)) {
					historyJson.history.sort((a, b) => b.taken[0] - a.taken[0]);

					historyJson.history.forEach(med => {
						historyLS.append(new MedicationObject({ obj: med }));
					});

					this.historyFilter = new Gtk.CustomFilter();

					this.filterHistoryModel = new Gtk.FilterListModel({
						model: historyLS,
						filter: this.historyFilter,
					});

					this.setHistorySearch();

					const sortedHistModelPromise = new Promise(resolve => {
						setTimeout(() => {
							resolve(
								(this.sortedHistoryModel = new Gtk.SortListModel({
									model: this.filterHistoryModel,
									section_sorter: new HistorySectionSorter(),
								})),
							);
						}, 200);
					});

					sortedHistModelPromise.then(_ => {
						this.histMultiSelect = new Gtk.MultiSelection({
							model: this.sortedHistoryModel,
						});

						this._historyList.model = this.histMultiSelect;

						this.histItemsToRm = [];
						this.setShowHistoryAmount();

						this.histMultiSelect.connect('selection-changed', (selModel, position, nItems) => {
							this.histItemsToRm.length = 0;

							const selectionBitset = selModel.get_selection();
							const maxSize = selectionBitset.get_maximum();

							for (let i = 0; i <= maxSize; i++) {
								if (selectionBitset.contains(i)) {
									const itRm = selModel.get_item(i);
									this.histItemsToRm.push(itRm);
								}
							}

							const noItems = this.histItemsToRm.length === 0;
							this._removeHistItemsBtn.visible = !noItems;
							this._unselectHistItemsBtn.visible = !noItems;
							this._toggleHistAmountBtn.visible =
								noItems && this.histMoreThan7Sect && !this.histQuery;
						});
					});

					this._historyList.remove_css_class('view');
					this._historyList.add_css_class('background');
					this._historyList.set_header_factory(historyHeaderFactory);
					this._historyList.set_factory(historyItemFactory);

					const app = this.app;
					this.showSearchAction = new Gio.SimpleAction({ name: 'showSearch' });
					app.set_accels_for_action('app.showSearch', ['<primary>f']);
					app.add_action(this.showSearchAction);

					historyLS.connect('items-changed', (model, pos, removed, added) => {
						if (!historyLS.get_item(0)) {
							this._searchBar.search_mode_enabled = false;
							this.setEmptyHistStatus();
							app.remove_action('showSearch');
						} else {
							const histVisible = this._viewStack.visible_child_name === 'history-page';
							this._buttonSearch.sensitive = true;
							this._buttonSearch.visible = histVisible;
							app.add_action(this.showSearchAction);
							this.histMoreThan7Sect = this.histHasMoreThan7Sect();
						}
					});

					const keyController = new Gtk.EventControllerKey();

					// to select item to be removed with ctrl pressed
					keyController.connect('key-pressed', (_, keyval, keycode, state) => {
						if (keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R) {
							this.ctrlPressed = true;
						}
					});
					keyController.connect('key-released', (_self, keyval, _keycode, _state) => {
						if (keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R) {
							this.ctrlPressed = false;
						}
					});

					this._historyList.add_controller(keyController);
				}
			} catch (err) {
				console.error('Error loading history:', err);
				this.errorLoading = true;
			}

			this.setEmptyHistStatus();
		}

		setHistorySearch() {
			this._buttonSearch.connect('clicked', () => {
				this._searchBar.search_mode_enabled = !this._searchBar.search_mode_enabled;
			});

			this._searchBar.connect('notify::search-mode-enabled', searchBar => {
				this._buttonSearch.active = searchBar.search_mode_enabled;
			});

			this.filterHistoryModel.connect('items-changed', () => {
				let noResults = !this.filterHistoryModel.get_item(0);
				this._emptyHistory.visible = noResults ? true : false;
				this._emptyHistory.title = noResults ? _('No Results Found') : _('Empty History');
			});

			this._searchEntry.connect('search-changed', () => {
				const removeDiacritics = str => {
					return str
						.toLowerCase()
						.normalize('NFD')
						.replace(/[\u0300-\u036f]/g, '');
				};

				const query = removeDiacritics(this._searchEntry.text.trim());

				if (!query) {
					this.histQuery = false;
					this.showAllHist = false;
					this.setShowHistoryAmount();
					this._emptyHistory.visible = false;
					this.scrollHistToTop();
					return;
				} else {
					this.histQuery = true;
				}

				this._toggleHistAmountBtn.visible = false;

				this.historyFilter.set_filter_func(item => {
					const itemName = removeDiacritics(item.obj.name);
					return itemName.includes(query);
				});
			});

			this._viewStack.connect('notify::visible-child', viewStack => {
				const todayVisible = viewStack.visible_child_name === 'today-page';
				this._btnWhenNeeded.visible = todayVisible && this.hasWhenNeeded;

				const histVisible = viewStack.visible_child_name === 'history-page';
				this._buttonSearch.visible = histVisible;
				this._searchBar.visible = histVisible;

				const treatmentsVisible = viewStack.visible_child_name === 'treatments-page';
				this._buttonTreatmentsSorter.visible = treatmentsVisible;

				if (histVisible) {
					this.showSearchAction.connect('activate', () => {
						this._searchBar.search_mode_enabled = true;
						this._searchEntry.grab_focus();
					});
				}
			});
		}

		loadToday() {
			this.todayItems = [];

			if (!this.todayLS) {
				this._todayList.remove_css_class('view');
				this._todayList.add_css_class('background');
				this._todayList.set_header_factory(todayHeaderFactory);
				this._todayList.set_factory(todayItemFactory);

				this.todayFilter = Gtk.CustomFilter.new(it => {
					return settings.get_boolean('show-when-needed') || it.obj.frequency !== 'when-needed';
				});

				this.todayLS = Gio.ListStore.new(MedicationObject);

				this.filterTodayModel = new Gtk.FilterListModel({
					model: this.todayLS,
					filter: this.todayFilter,
				});

				this.sortedTodayModel = new Gtk.SortListModel({
					model: this.filterTodayModel,
					section_sorter: new TodaySectionSorter(),
				});

				this.todayMultiSelect = new Gtk.MultiSelection({
					model: this.sortedTodayModel,
				});

				this._todayList.model = this.todayMultiSelect;

				this.todayMultiSelect.connect('selection-changed', (selModel, position, nItems) => {
					this.todayItems.length = 0;

					const selectionBitset = selModel.get_selection();
					const maxSize = selectionBitset.get_maximum();

					for (let i = 0; i <= maxSize; i++) {
						if (selectionBitset.contains(i)) {
							const item = selModel.get_item(i);
							this.todayItems.push(item);
						}
					}

					const hasTodayItems = this.todayItems.length > 0;
					this.updateEntryBtn(hasTodayItems);
				});
			}

			this.todayLS.remove_all();

			this.hasWhenNeeded = false;

			const tempList = [];
			const today = new Date();
			today.setHours(0, 0, 0, 0);

			for (const it of treatmentsLS) {
				const item = it.obj;
				const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
				const end = new Date(item.duration.end).setHours(0, 0, 0, 0);
				const isWhenNd = item.frequency === 'when-needed';

				for (const timeDose of item.dosage) {
					const noLastTk = timeDose.lastTaken === null;
					const isMedDay = isTodayMedDay(
						today,
						item.frequency,
						item.duration.enabled,
						start,
						end,
						item.cycle,
						item.days,
						item.monthDay,
					);

					if ((isMedDay && noLastTk) || isWhenNd) {
						tempList.push(
							new MedicationObject({
								obj: {
									name: item.name,
									unit: item.unit,
									notes: item.notes,
									color: item.color,
									icon: item.icon,
									notification: item.notification,
									time: [timeDose.time[0], timeDose.time[1]],
									dose: timeDose.dose,
									originalDose: timeDose.dose,
									frequency: isWhenNd ? 'when-needed' : undefined,
									dateTodayLS: new Date(),
									originalDose: timeDose.dose,
								},
							}),
						);
					}

					// only one dose
					if (isWhenNd) {
						this.hasWhenNeeded = true;
						break;
					}
				}
			}

			this.todayLS.splice(0, 0, tempList);

			this.todayLS.sort((a, b) => {
				return a.obj.name.localeCompare(b.obj.name);
			});

			const noItems = this.sortedTodayModel.get_n_items() === 0;
			const noTreatments = this._treatmentsList.model.get_n_items() === 0;

			this._emptyTreatments.set_visible(noTreatments);
			this._emptyToday.set_visible(noItems);
			this._emptyToday.icon_name = noTreatments ? 'pill-symbolic' : 'all-done-symbolic';
			this._emptyToday.title = noTreatments ? _('No Treatments Added') : _('All Done for Today');

			const todayVisible = this._viewStack.visible_child_name === 'today-page';
			this._btnWhenNeeded.visible = todayVisible && this.hasWhenNeeded;
			this._btnWhenNeeded.active = settings.get_boolean('show-when-needed');
			if (!noItems) this._todayList.scroll_to(0, null, null);
		}

		scrollHistToTop() {
			setTimeout(() => {
				this._historyList.scroll_to(0, null, null);
			}, 100);
		}

		clearOldHistoryEntries() {
			if (!settings.get_boolean('clear-old-hist')) return;

			const itemsHolder = {};

			for (const it of historyLS) {
				const item = it.obj;
				const dateKey = new Date(item.taken[0]).setHours(0, 0, 0, 0);
				if (!itemsHolder[dateKey]) {
					itemsHolder[dateKey] = [];
				}
				itemsHolder[dateKey].push(new MedicationObject({ obj: item }));
			}

			historyLS.remove_all();

			const dateKeys = Object.keys(itemsHolder).sort((a, b) => b.localeCompare(a));

			for (const date of dateKeys.slice(0, 30)) {
				const itemsToAdd = itemsHolder[date];
				historyLS.splice(0, 0, itemsToAdd);
				historyLS.sort((a, b) => {
					const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
					const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);
					return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
				});
			}

			return true;
		}

		scheduleNotifications(action) {
			for (const id in this.scheduledItems) {
				clearTimeout(this.scheduledItems[id]);
			}

			this.scheduledItems = {};
			this.todayGroupedObj = {};

			const todayLength = this.todayMultiSelect.n_items;

			for (let i = 0; i < todayLength; i++) {
				const item = this.todayMultiSelect.get_item(i).obj;
				if (item.frequency !== 'when-needed') {
					this.groupTodayList(this.todayMultiSelect.get_item(i));
				}
			}

			this.addToBeNotified(action);
		}

		groupTodayList(med) {
			const item = med.obj;
			const itemHour = item.time[0];
			const itemMin = item.time[1];

			const dateKey = new Date().setHours(itemHour, itemMin, 0, 0);

			if (!this.todayGroupedObj[dateKey]) {
				this.todayGroupedObj[dateKey] = [];
			}

			this.todayGroupedObj[dateKey].push(item);
		}

		addToBeNotified(action) {
			for (let dateKey in this.todayGroupedObj) {
				const groupedObj = this.todayGroupedObj;
				const now = new Date();
				const hours = now.getHours();
				const minutes = now.getMinutes();
				const seconds = now.getSeconds();
				const dateTime = GLib.DateTime.new_from_unix_local(+dateKey / 1000);
				const isSingleItem = groupedObj[dateKey].length === 1;
				const confirmStr = isSingleItem ? _('Confirm') : _('Confirm All');
				const skipStr = isSingleItem ? _('Skip') : _('Skip All');

				const itemHour = dateTime.get_hour();
				const itemMin = dateTime.get_minute();
				let timeDiff = (itemHour - hours) * 3600000 + (itemMin - minutes) * 60000 - seconds * 1000;

				const time = dateTime.format(timeFormat);

				const notify = () => {
					// notifications from the past will be sent again instantly (setTimeout is < 0)
					// when performing some action like saving/adding/updating/removing
					// because it needs to be rescheduled at every action
					// so don't send notifications in this case
					if (action && action != 'sleep' && timeDiff < 0) {
						timeDiff = 0;
						return;
					}
					const [notification, app] = this.getNotification();

					let body = '';
					const maxLength = 3;
					const itemsToDisplay = groupedObj[dateKey].slice(0, maxLength);

					body = itemsToDisplay
						.map(item => `${item.name} ⸱ ${item.dose} ${item.unit}`)
						.join('\n\r');

					if (groupedObj[dateKey].length > maxLength) {
						const moreItemsCount = groupedObj[dateKey].length - maxLength;
						const text = `${itemsToDisplay.map(item => item.name).join(', ')} ${_(
							// TRANSLATORS: keep the %d it's where the number goes
							'and %d more',
						).replace('%d', moreItemsCount)}`;
						body = text;
					}

					let title = _('Reminder') + ` · ` + time;
					notification.set_title(title);
					notification.set_body(body);

					if (settings.get_boolean('confirm-button')) {
						notification.add_button(confirmStr, `app.confirm${dateKey}`);
					}

					if (settings.get_boolean('skip-button')) {
						notification.add_button(skipStr, `app.skip${dateKey}`);
					}

					const increasePriority = itemsToDisplay.some(
						obj => obj.notification.increasePriority === true,
					);

					if (increasePriority) {
						notification.set_priority(Gio.NotificationPriority.URGENT);
					}

					const schedule = () => {
						this.updateEverything({ isNotifAction: true, skipCycleUp: true });
						this.scheduleNotifications();
						this.scrollHistToTop();
					};

					const confirmAction = new Gio.SimpleAction({
						name: `confirm${dateKey}`,
					});
					confirmAction.connect('activate', () => {
						const confirmPromise = new Promise((resolve, reject) => {
							resolve(this.addNotifItemsToHistory(groupedObj[dateKey], 1));
						}).catch(console.error);
						confirmPromise.then(_ => schedule());
					});

					const skipAction = new Gio.SimpleAction({ name: `skip${dateKey}` });
					skipAction.connect('activate', () => {
						const skipPromise = new Promise((resolve, reject) => {
							resolve(this.addNotifItemsToHistory(groupedObj[dateKey], 0));
						}).catch(console.error);
						skipPromise.then(_ => schedule());
					});

					app.add_action(confirmAction);
					app.add_action(skipAction);

					if (settings.get_boolean('sound') && action != 'sleep' && !this.played) {
						const ding = Gio.File.new_for_uri(
							'resource:///io/github/diegopvlk/Dosage/sounds/ding.ogg',
						);
						const mediaFile = Gtk.MediaFile.new_for_file(ding);
						mediaFile.play();

						// when using notification buttons, assuming the app is not visible,
						// all past items from today will be notified, so the user can see them all
						// so avoid playing the sound at every notification
						(async () => {
							this.played = true;
							await new Promise(res => setTimeout(res, 5000));
							this.played = false;
						})();
					}

					app.withdraw_notification(`${dateKey}`);
					app.send_notification(`${dateKey}`, notification);
				};

				let recurringInterval = 99;
				let recurringEnabled = false;

				groupedObj[dateKey].map(item => {
					const recurr = item.notification.recurring;
					if (recurr.enabled) recurringEnabled = true;
					if (recurr.enabled && recurr.interval < recurringInterval) {
						recurringInterval = recurr.interval;
					}
				});

				if (recurringEnabled) {
					const interval = recurringInterval;
					const minutes = interval * 60 * 1000;
					const recurringNotify = (dateKey, timeDiff) => {
						this.scheduledItems[dateKey] = setTimeout(() => {
							notify();
							recurringNotify(dateKey, minutes);
						}, timeDiff);
					};

					recurringNotify(dateKey, timeDiff);
					continue;
				}

				this.scheduledItems[dateKey] = setTimeout(notify, timeDiff);
			}
		}

		getNotification() {
			const app = this.app;
			const notification = new Gio.Notification();
			const openAction = new Gio.SimpleAction({ name: 'open' });

			const icon = Gio.ThemedIcon.new_from_names([
				'preferences-system-time-symbolic',
				'alarm-symbolic',
				'appointment-soon-symbolic',
			]);

			notification.set_icon(icon);

			notification.set_default_action('app.open');
			openAction.connect('activate', () => {
				app.activate();
				this.present();
			});
			app.add_action(openAction);

			notification.set_title(_('Dosage'));

			return [notification, app];
		}

		setShowWhenNeeded() {
			this.unselectTodayItems();
			const btn = this._btnWhenNeeded;
			settings.set_boolean('show-when-needed', btn.active);
			this.loadToday();
		}

		selectTodayItems(list, position, groupCheck) {
			const isSelected = this.todayMultiSelect.is_selected(position);

			if (groupCheck || !isSelected) {
				this.todayMultiSelect.select_item(position, false);
			} else {
				this.todayMultiSelect.unselect_item(position);
			}
		}

		unselectTodayItems() {
			this.todayItems.length = 0;
			this.todayMultiSelect.unselect_all();
			this.updateEntryBtn(false);
		}

		updateEntryBtn(hasTodayItems) {
			this._entryBtn.label = hasTodayItems ? _('Confirm') : _('One-Time Entry');
			this._skipBtn.set_visible(hasTodayItems);
			this._unselectBtn.set_visible(hasTodayItems);

			const hasWN = this.todayItems.some(i => i.obj.frequency === 'when-needed');
			this._skipBtn.sensitive = !hasWN;

			if (hasTodayItems) {
				this._entryBtn.add_css_class('suggested-action');
			} else {
				this._entryBtn.remove_css_class('suggested-action');
			}
		}

		addTodayToHistory(btn) {
			const taken = +btn.get_name(); // 1 or 0
			const app = this.app;
			const itemsToAdd = [];
			const date = new Date();
			const hours = date.getHours();
			const minutes = date.getMinutes();
			const time = [hours, minutes];

			if (this.todayItems.length > 0) {
				this.todayItems.forEach(it => {
					const item = it.obj;

					const isWhenNd = item.frequency === 'when-needed';
					itemsToAdd.push(
						new MedicationObject({
							obj: {
								name: item.name,
								unit: item.unit,
								time: isWhenNd ? time : item.time,
								dose: item.dose,
								color: item.color,
								taken: [new Date().getTime(), taken],
							},
						}),
					);

					if (isWhenNd) {
						this.updateTreatInventory(item, taken);
					} else {
						this.updateTreatInvAndLastTk(item, taken);
					}

					const itemHour = item.time[0];
					const itemMin = item.time[1];
					const dateKey = new Date().setHours(itemHour, itemMin, 0, 0);
					app.withdraw_notification(`${dateKey}`);
				});

				historyLS.splice(0, 0, itemsToAdd.reverse());

				this.updateEverything({ skipCycleUp: true });
				this.scheduleNotifications('adding');
				this.scrollHistToTop();
			} else {
				// one-time entry
				if (!this.delayDialog) {
					openOneTimeDialog(this);
					this.delayDialog = true;
					setTimeout(() => {
						this.delayDialog = false;
					}, 500);
				}
			}

			this.updateEntryBtn(false);
		}

		updateTreatInvAndLastTk(item, taken) {
			for (const it of treatmentsLS) {
				const treatItem = it.obj;
				const sameName = item.name === treatItem.name;
				const itemTime = String(item.time);
				const updateInv = sameName && treatItem.inventory.enabled && taken === 1;

				if (updateInv) treatItem.inventory.current -= item.dose;

				if (sameName) {
					treatItem.dosage.forEach(timeDose => {
						const sameTime = itemTime === String(timeDose.time);
						if (sameTime) {
							timeDose.lastTaken = new Date().toISOString();
						}
					});

					// trigger signal to update labels
					it.notify('obj');

					return;
				}
			}
		}

		updateTreatInventory(item, { increase = false } = {}) {
			for (const it of treatmentsLS) {
				const treatItem = it.obj;
				const sameName = item.name === treatItem.name;
				const updateInv = sameName && treatItem.inventory.enabled;

				if (updateInv) {
					if (increase) {
						treatItem.inventory.current += item.dose;
					} else {
						treatItem.inventory.current -= item.dose;
					}
					// trigger signal to update labels
					it.notify('obj');
					return;
				}
			}
		}

		addNotifItemsToHistory(groupedArr, taken) {
			const itemsToAdd = [];
			const now = new Date();
			const today = new Date().setHours(0, 0, 0, 0);

			groupedArr.forEach(item => {
				const dateLS = item.dateTodayLS.setHours(0, 0, 0, 0);

				if (dateLS !== today) {
					const dateLSItem = new Date(item.dateTodayLS);
					dateLSItem.setHours(23, 59, 59, 999);

					for (const it of historyLS) {
						const sameName = it.obj.name === item.name;
						const sameTime = String(it.obj.time) === String(item.time);
						const sameUnit = it.obj.unit === item.unit;
						const sameDose = it.obj.dose === item.dose;
						const sameDate = new Date(it.obj.taken[0]).setHours(0, 0, 0, 0) === dateLS;
						const isMissed = it.obj.taken[1] === -1;
						const isMarkedConfirmed = it.obj.taken[1] === 2;

						if (
							sameName &&
							sameTime &&
							sameUnit &&
							sameDose &&
							sameDate &&
							(isMissed || isMarkedConfirmed)
						) {
							it.obj.taken[0] = dateLSItem.getTime();
							// 3 for items not confirmed today
							it.obj.taken[1] = taken === 1 ? 3 : 0;

							if (taken === 0 && isMarkedConfirmed) {
								this.updateTreatInventory(item, { increase: true });
							} else if (taken === 1 && isMissed) {
								this.updateTreatInventory(item);
							}

							it.notify('obj');
							break;
						}
					}
				} else {
					itemsToAdd.push(
						new MedicationObject({
							obj: {
								name: item.name,
								unit: item.unit,
								time: item.time,
								dose: item.dose,
								color: item.color,
								taken: [now.getTime(), taken],
							},
						}),
					);
					this.updateTreatInvAndLastTk(item, taken);
				}
			});

			historyLS.splice(0, 0, itemsToAdd.reverse());
		}

		editHistoryItem(list, position) {
			if (this.ctrlPressed) {
				const isSelected = this.histMultiSelect.is_selected(position);

				if (!isSelected) {
					this.histMultiSelect.select_item(position, false);
				} else {
					this.histMultiSelect.unselect_item(position);
				}
				return;
			}
			openEditHistDialog(this, list, position);
		}

		updateJsonFile(type, listStore, lsIsEmpty) {
			const fileName = `dosage-${type}.json`;
			const file = DataDir.get_child(fileName);
			let tempObj;

			try {
				tempObj = createTempObj(type, listStore, lsIsEmpty);
			} catch (err) {
				this.errDialog.add_response('quit', _('Quit'));
				this.errDialog.connect('response', (_self, response) => {
					if (response === 'quit') this.app.quit();
				});
				this.errDialog.body = err;
				this.errDialog.present(this);
				this.errDialog.set_can_close(false);
				console.error(err);
				return;
			}

			if (!tempObj || this.errorLoading) return;

			if (type === 'treatments') {
				tempObj.version = this.treatmentsVersion;
				tempObj.lastUpdate = new Date().toISOString();
				this.lastUpdate = tempObj.lastUpdate;
			} else {
				tempObj.version = this.historyVersion;
			}

			const jsonStr = JSON.stringify(tempObj);

			const updateFile = () => {
				return new Promise((resolve, reject) => {
					const byteArray = new TextEncoder().encode(jsonStr);
					file.replace_contents_async(
						GLib.Bytes.new(byteArray),
						null,
						false,
						Gio.FileCreateFlags.REPLACE_DESTINATION,
						null,
						(file, result, userData) => {
							try {
								file.replace_contents_finish(result);
							} catch (err) {
								console.error(`Update of ${fileName} failed: ${err}`);
								reject(err);
							}
						},
						null,
					);
				});
			};

			updateFile()
				.then(() => {})
				.catch(err => console.error('Update failed:', err));
		}

		addMissedItems() {
			let itemsAdded = false;
			const itemsToAdd = [];

			const insert = (timeDose, tempItem, nextDate) => {
				if (!timeDose.lastTaken) {
					const nextDt = new Date(nextDate);
					let taken = -1;

					if (tempItem.markConfirmed) {
						nextDt.setHours(timeDose.time[0]);
						nextDt.setMinutes(timeDose.time[1]);
						taken = 2;
					} else {
						nextDt.setHours(23, 59, 59, 999);
					}

					itemsToAdd.push(
						new MedicationObject({
							obj: {
								name: tempItem.name,
								unit: tempItem.unit,
								time: tempItem.time,
								dose: tempItem.dose,
								color: tempItem.color,
								taken: [nextDt.getTime(), taken],
							},
						}),
					);

					itemsAdded = true;
				}
			};

			const lastUpdate = new Date(this.lastUpdate);
			const today = new Date();
			const twoMonthsAgo = new Date();
			twoMonthsAgo.setMonth(today.getMonth() - 2);
			const daysDiff = Math.floor((today - lastUpdate) / 86400000);
			if (daysDiff >= 60) {
				// if the app was closed for more than 2 months
				// only add missed items from the last 2 months
				this.lastUpdate = twoMonthsAgo.toISOString();
			}

			today.setHours(0, 0, 0, 0);
			for (const it of treatmentsLS) {
				const nextDate = new Date(this.lastUpdate);
				const item = it.obj;
				const end = new Date(item.duration.end);
				const start = new Date(item.duration.start);
				nextDate.setHours(0, 0, 0, 0);
				end.setHours(0, 0, 0, 0);
				start.setHours(0, 0, 0, 0);

				let current = item.cycle[2];

				while (nextDate < today) {
					if (item.duration.enabled && (start > nextDate || end < nextDate)) break;
					const [active, inactive] = item.cycle;

					const invEnabled = item.inventory.enabled && item.markConfirmed;

					item.dosage.forEach(timeDose => {
						const udpdateInv = () => {
							if (invEnabled && !timeDose.lastTaken) {
								item.inventory.current -= timeDose.dose;
							}
						};

						const tempItem = { ...item };
						tempItem.time = [timeDose.time[0], timeDose.time[1]];
						tempItem.dose = timeDose.dose;

						switch (item.frequency) {
							case 'daily':
								insert(timeDose, tempItem, nextDate);
								udpdateInv();
								break;
							case 'specific-days':
								if (item.days.includes(nextDate.getDay())) {
									insert(timeDose, tempItem, nextDate);
									udpdateInv();
								}
								break;
							case 'day-of-month':
								if (item.monthDay === nextDate.getDate()) {
									insert(timeDose, tempItem, nextDate);
									udpdateInv();
								}
								break;
							case 'cycle':
								if (current <= active) {
									insert(timeDose, tempItem, nextDate);
									udpdateInv();
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

					// trigger signal to update labels
					it.notify('obj');
				}
			}

			itemsToAdd.sort((a, b) => b.obj.taken[0] - a.obj.taken[0]);
			historyLS.splice(0, 0, itemsToAdd);
			return itemsAdded;
		}

		updateCycleAndLastUp(skipCycleUp) {
			const lastUpdate = new Date(this.lastUpdate);
			const lastUp = lastUpdate.setHours(0, 0, 0, 0);
			const today = new Date().setHours(0, 0, 0, 0);

			if (lastUp < today) this.lastUpdate = new Date().toISOString();

			if (skipCycleUp) return;

			for (const it of treatmentsLS) {
				const item = it.obj;
				const start = new Date(item.duration.start).setHours(0, 0, 0, 0);

				function findDate(start) {
					let nextDtStr;
					let curr = item.cycle[2];
					let nextDate = start ? new Date(start) : new Date();
					nextDate.setHours(0, 0, 0, 0);

					while (true) {
						nextDtStr = nextDate.toISOString();
						const [active, inactive] = item.cycle;
						if (curr <= active) break;
						curr += 1;
						if (curr > active + inactive) curr = 1;
						nextDate.setDate(nextDate.getDate() + 1);
					}

					return nextDtStr;
				}

				if (item.frequency == 'cycle') {
					if (start < today) {
						const datesPassed = datesPassedDiff(lastUpdate, new Date());
						let [active, inactive, current] = item.cycle;

						for (let i = 0; i < datesPassed.length; i++) {
							current += 1;
							if (current > active + inactive) current = 1;
						}

						item.cycle[2] = current;
						item.cycleNextDate = findDate();
					} else {
						item.cycleNextDate = findDate(item.duration.start);
					}

					// trigger signal to update labels
					it.notify('obj');
				}
			}
		}

		setEmptyHistStatus() {
			if (!historyLS.get_item(0)) {
				this._emptyHistory.title = _('Empty History');
				this._emptyHistory.visible = true;
				this._buttonSearch.sensitive = false;
				this._searchBar.search_mode_enabled = false;
				this.app.remove_action('showSearch');
			}
		}

		updateEverything({
			skipHistUp = false,
			isNotifAction = false,
			skipCycleUp = false,
			histIsEmpty = false,
			treatIsEmpty = false,
		} = {}) {
			this.setShowHistoryAmount();
			this.updateCycleAndLastUp(skipCycleUp);
			this.updateJsonFile('treatments', treatmentsLS, treatIsEmpty);
			this.loadToday();
			this.updateEntryBtn(false);
			this.checkInventory(isNotifAction);
			this.unselectHistItems();
			if (!skipHistUp) this.updateJsonFile('history', historyLS, histIsEmpty);
		}

		openMedDialog(list, position, duplicate) {
			// artificial delay to avoid opening multiple dialogs when double clicking button
			if (!this.delayDialog) {
				openMedicationDialog(this, list, position, duplicate);
				this.delayDialog = true;
				setTimeout(() => {
					this.delayDialog = false;
				}, 500);
			}
		}
	},
);
