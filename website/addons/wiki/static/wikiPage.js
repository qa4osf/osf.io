'use strict';
var ko = require('knockout');
var $ = require('jquery');
var $osf = require('osfHelpers');

var mathrender = require('mathrender');
var md = require('markdown').full;
var mdQuick = require('markdown').quick;
var diffTool = require('wikiDiff');

var THROTTLE = 500;

//<div id="preview" data-bind="mathjaxify">
ko.bindingHandlers.mathjaxify = {
    update: function(element, valueAccessor, allBindingsAccessor, data, context) {
        var vm = context.$data;

        if(vm.allowMathjaxification() && vm.allowFullRender()) {
            mathrender.mathjaxify('#' + element.id);
        }
    }
};


function ViewWidget(visible, version, viewText, rendered, contentURL, allowMathjaxification, allowFullRender, editor) {
    var self = this;
    self.version = version;
    self.viewText = viewText; // comes from EditWidget.viewText
    self.rendered = rendered;
    self.visible = visible;
    self.allowMathjaxification = allowMathjaxification;
    self.editor = editor;
    self.allowFullRender = allowFullRender;
    self.renderTimeout = null;
    self.displaySource = ko.observable('');

    self.renderMarkdown = function(rawContent){
        if(self.allowFullRender()) {
            return md.render(rawContent);
        } else {
            return mdQuick.render(rawContent);
        }
    };

    if (typeof self.editor !== 'undefined') {
        self.editor.on('change', function () {
            // Quick render
            self.allowFullRender(false);
            // Full render
            clearTimeout(self.renderTimeout);

            self.renderTimeout = setTimeout(function () {
                self.allowFullRender(true);
            }, THROTTLE);
        });
    } else {
        self.allowFullRender(true);
    }

    self.displayText =  ko.computed(function() {
        var requestURL;
        if (typeof self.version() !== 'undefined') {
            if (self.version() === 'preview') {
                self.rendered(self.renderMarkdown(self.viewText()));
                self.displaySource(self.viewText());
            } else {
                if (self.version() === 'current') {
                    requestURL = contentURL;
                } else {
                    requestURL= contentURL + self.version();
                }
                var request = $.ajax({
                    url: requestURL
                });

                request.done(function (resp) {
                    var rawContent = resp.wiki_content || '*No wiki content*';
                    if (resp.wiki_rendered) {
                        // Use pre-rendered python, if provided. Don't mathjaxify
                        self.allowMathjaxification(false);
                        if(self.visible()) {
                            self.rendered(resp.wiki_rendered);
                        }
                    } else {
                        // Render raw markdown
                        if(self.visible()) {
                            self.allowMathjaxification(true);
                            self.rendered(self.renderMarkdown(rawContent));
                        }
                    }
                    self.displaySource(rawContent);
                });
            }
        } else {
            self.displaySource('');
        }
    });
}

    // currentText comes from ViewWidget.displayText
function CompareWidget(visible, compareVersion, currentText, rendered, contentURL) {
    var self = this;

    self.compareVersion = compareVersion;
    self.currentText = currentText;
    self.rendered = rendered;
    self.visible = visible;
    self.contentURL = contentURL;
    self.compareSource = ko.observable('');

    self.compareText = ko.computed(function() {
        var requestURL;
        if (self.compareVersion() === 'current') {
            requestURL = self.contentURL;
        } else {
            requestURL= self.contentURL + self.compareVersion();
        }
        var request = $.ajax({
            url: requestURL
        });
        request.done(function (resp) {
            var rawText = resp.wiki_content;
            self.compareSource(rawText);
        });

    });

    self.compareOutput = ko.computed(function() {
        var output = diffTool.diff(self.compareSource(), self.currentText());
        self.rendered(output);
        return output;
    }).extend({ notify: 'always' });

}


var defaultOptions = {
    editVisible: false,
    viewVisible: true,
    compareVisible: false,
    canEdit: true,
    viewVersion: 'current',
    compareVersion: 'current',
    urls: {
        content: '',
        draft: '',
        page: ''
    },
    metadata: {}
};

function ViewModel(options){
    var self = this;

    // enabled?
    self.editVis = ko.observable(options.editVisible);
    self.viewVis = ko.observable(options.viewVisible);
    self.compareVis = ko.observable(options.compareVisible);

    self.compareVersion = ko.observable(options.compareVersion);
    self.viewVersion = ko.observable(options.viewVersion);
    self.draftURL = options.urls.draft;
    self.contentURL = options.urls.content;
    self.pageURL = options.urls.page;
    self.editorMetadata = options.metadata;
    self.canEdit = options.canEdit;

    self.viewText = ko.observable('');
    self.renderedView = ko.observable('');
    self.renderedCompare = ko.observable('');
    self.allowMathjaxification = ko.observable(true);
    self.allowFullRender = ko.observable(true);

    self.currentURL = ko.computed(function() {
        console.log("ping");
        var url = self.pageURL;

        if (self.editVis()) {
            url += 'edit/';
        }
        if (self.viewVis() && ((self.editVis() && self.compareVis()) || (self.viewVersion() !== 'current' && self.viewVersion() !== 'preview'))) {
            url += 'view/';
            if(self.viewVersion() !== 'current' && self.viewVersion() !== 'preview'){
                url += self.viewVersion() + '/';
            }
        }
        if (self.compareVis()) {
            url += 'compare/';
            if(self.compareVersion() !== 'current'){
                url += self.compareVesion() + '/';
            }
        }
        console.log(url);

        history.replaceState({}, '', url);
    });


    if(self.canEdit) {
        self.editor = ace.edit('editor');

        var ShareJSDoc = require('addons/wiki/static/ShareJSDoc.js');
        self.editVM = new ShareJSDoc(self.draftURL, self.editorMetadata, self.viewText, self.editor);
    }
    self.viewVM = new ViewWidget(self.viewVis, self.viewVersion, self.viewText, self.renderedView, self.contentURL, self.allowMathjaxification, self.allowFullRender, self.editor);
    self.compareVM = new CompareWidget(self.compareVis, self.compareVersion, self.viewVM.displaySource, self.renderedCompare, self.contentURL);

    $('body').on('togglePanel', function (event, panel, display) {
        // Update self.editVis, self.viewVis, or self.compareVis in viewmodel
        self[panel + 'Vis'](display);

        //URL needs to be a computed observable, and this should just update the panel states, which will feed URL


        // Switch view to correct version
        if (panel === 'edit') {
            if (display) {
                self.viewVersion('preview');
            } else if (self.viewVersion() === 'preview') {
                self.viewVersion('current');
            }
        }
    });
}



var WikiPage = function(selector, options) {
    var self = this;
    self.options = $.extend({}, defaultOptions, options);

    this.viewModel = new ViewModel(self.options);
    $osf.applyBindings(self.viewModel, selector);
};

module.exports = WikiPage;

//self.ButtonController = {
//        view.onClick = function () {
//        // logic...
//        $(this).trigger('editEnabled')
//    };


