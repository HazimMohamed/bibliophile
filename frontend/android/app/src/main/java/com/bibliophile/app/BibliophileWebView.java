package com.bibliophile.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import com.getcapacitor.CapacitorWebView;

public class BibliophileWebView extends CapacitorWebView {

    private boolean readerSelectionOverrideEnabled = false;

    public BibliophileWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setReaderSelectionOverrideEnabled(boolean enabled) {
        readerSelectionOverrideEnabled = enabled;
        if (!enabled) {
            dispatchSelectionLifecycle("selectionDismissed");
        }
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        if (!readerSelectionOverrideEnabled) {
            return super.startActionMode(callback);
        }
        dispatchSelectionLifecycle("selectionStarted");
        ActionMode actionMode = super.startActionMode(new SuppressedSelectionActionModeCallback());
        if (actionMode != null) {
            actionMode.hide(0);
        }
        return actionMode;
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        if (!readerSelectionOverrideEnabled) {
            return super.startActionMode(callback, type);
        }
        dispatchSelectionLifecycle("selectionStarted");
        ActionMode actionMode = super.startActionMode(new SuppressedSelectionActionModeCallback(), type);
        if (actionMode != null && type == ActionMode.TYPE_FLOATING) {
            actionMode.hide(0);
        }
        return actionMode;
    }

    private void dispatchSelectionLifecycle(String phase) {
        post(() ->
            evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('bibliophile-native-selection', { detail: { phase: '" + phase + "' } }));",
                null
            )
        );
    }

    private final class SuppressedSelectionActionModeCallback implements ActionMode.Callback {

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            menu.clear();
            dispatchSelectionLifecycle("selectionStarted");
            return true;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            menu.clear();
            dispatchSelectionLifecycle("selectionChanged");
            mode.hide(0);
            return true;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return false;
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            dispatchSelectionLifecycle("selectionDismissed");
        }
    }
}
