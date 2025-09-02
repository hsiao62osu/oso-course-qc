document.addEventListener('DOMContentLoaded', () => {
    const LINK_TYPES = ['osu', 'external', 'course', 'unknown'];
    /* =========================================================================
       State & Shared Utilities
       ========================================================================= */
    const allResources = [];
    const allModules = [];
    /**
     * Stored summary of accessibility scan results.
     * Structure includes axe results categories: violations, passes, incomplete, inapplicable
     */
    let accessibilityData;
    // Shared DOMParser instance to reuse across parsing operations
    const SHARED_PARSER = new DOMParser();
    // DOM element references (cached)
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const fileNameEl = document.getElementById('file-name');
    const fileSizeEl = document.getElementById('file-size');
    const uploadSection = document.getElementById('upload-section');
    const loadingSection = document.getElementById('loading-section');
    const loadingStatus = document.getElementById('loading-status');
    const progressBar = document.getElementById('progress-bar');
    const resultsSection = document.getElementById('results-section');
    const tabButtons = resultsSection.querySelectorAll('.tab-btn');
    const tabContents = resultsSection.querySelectorAll('.tab-content');
    /* =========================================================================
       Small DOM helpers
       ========================================================================= */
    /**
     * Safely set innerHTML for an element by id.
     */
    function setInnerHTMLById(id, html) {
        const el = document.getElementById(id);
        if (el)
            el.innerHTML = html;
    }
    /**
     * Clear the contents of an element by id.
     */
    function clearById(id) {
        const el = document.getElementById(id);
        if (el)
            el.innerHTML = '';
    }
    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    /* =========================================================================
       Tabs
       ========================================================================= */
    /**
     * Toggle visible tab content and button styles.
     * Do not change semantics (keeps same class toggles as original).
     * targetId - suffix used in ids (e.g. 'structure' to show #tab-content-structure)
     */
    function switchTab(targetId) {
        tabContents.forEach(content => {
            content.classList.toggle('hidden', content.id !== `tab-content-${targetId}`);
        });
        tabButtons.forEach(button => {
            const isTarget = button.id === `tab-btn-${targetId}`;
            button.classList.toggle('border-indigo-500', isTarget);
            button.classList.toggle('text-indigo-600', isTarget);
            button.classList.toggle('border-transparent', !isTarget);
            button.classList.toggle('text-gray-500', !isTarget);
            button.classList.toggle('hover:text-gray-700', !isTarget);
            button.classList.toggle('hover:border-gray-300', !isTarget);
        });
    }
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.id.replace('tab-btn-', '');
            switchTab(targetId);
        });
    });
    /* =========================================================================
       Drag & Drop / File selection
       ========================================================================= */
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length)
            handleFile(files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if ('files' in e.target && e.target.files instanceof Array && e.target.files.length > 0)
            handleFile(e.target.files[0]);
    });
    /* =========================================================================
       Progress & UI helpers
       ========================================================================= */
    /**
     * Update progress bar width and status message.
     */
    function updateProgress(percentage, status) {
        progressBar.style.width = `${percentage}%`;
        loadingStatus.textContent = status;
    }
    /**
     * Reset all result panes to their initial empty states.
     */
    function resetResults() {
        setInnerHTMLById('course-structure', '');
        setInnerHTMLById('course-content-list', '');
        setInnerHTMLById('accessibility-results', '<p class="text-gray-500">No issues found or analysis not run.</p>');
        setInnerHTMLById('accessibility-controls', '');
        setInnerHTMLById('link-inventory-results', '<p class="text-gray-500">No links found or analysis not run.</p>');
        setInnerHTMLById('file-attachment-results', '<p class="text-gray-500">No file attachments found.</p>');
        setInnerHTMLById('video-results', '<p class="text-gray-500">No videos found or analysis not run.</p>');
        setInnerHTMLById('link-summary', '');
        setInnerHTMLById('file-attachment-summary', '');
        setInnerHTMLById('video-summary', '');
    }
    /* =========================================================================
       Archive extraction
       ========================================================================= */
    /**
     * Extracts files from the provided ZIP archive and returns a map of name->content.
     */
    async function extractArchive(file) {
        try {
            updateProgress(10, 'Unzipping archive...');
            const zip = await JSZip.loadAsync(file);
            updateProgress(30, 'Reading all course files...');
            const fileContents = {};
            const zipFiles = Object.values(zip.files).filter(f => !f.dir && !f.name.startsWith('web_resources/'));
            const totalFiles = zipFiles.length;
            let fileCount = 0;
            for (const zipEntry of zipFiles) {
                const content = await zipEntry.async('string');
                fileContents[zipEntry.name] = content;
                fileCount++;
                const progress = 30 + (60 * (fileCount / totalFiles));
                updateProgress(progress, `Reading file ${fileCount} of ${totalFiles}`);
            }
            return fileContents;
        }
        catch (error) {
            loadingStatus.textContent = `Error: ${error.message}`;
            progressBar.style.backgroundColor = '#ef4444';
            throw error;
        }
    }
    /* =========================================================================
       File handling (entry point)
       ========================================================================= */
    /**
     * Handle file selected by user (drag/drop or file dialog).
     * Shows progress UI and kicks off analysis pipeline.
     */
    function handleFile(file) {
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
        fileInfo.classList.remove('hidden');
        uploadSection.classList.add('hidden');
        loadingSection.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        resetResults();
        switchTab('structure');
        (async () => {
            try {
                const fileContents = await extractArchive(file);
                await processAndAnalyze(fileContents);
                updateProgress(100, 'Analysis complete!');
                loadingSection.classList.add('hidden');
                resultsSection.classList.remove('hidden');
            }
            catch (err) {
                console.error(err);
            }
        })();
    }
    /* =========================================================================
       Manifest parsing and content assembly
       ========================================================================= */
    /**
     * Parse the imsmanifest and assemble course structure, content items, and then analyze.
     * Preserves original behavior and logic.
     */
    async function processAndAnalyze(fileContents) {
        const inModuleResourceIdentifiers = new Set();
        updateProgress(90, 'Parsing manifest...');
        // Helper to find a manifest <item> element by an identifier (e.g., a meta item's identifier)
        const findManifestItemElementByIdentifier = (id) => {
            if (!id)
                return null;
            return Array.from(manifestFileContentParsed.getElementsByTagName('item')).find(i => i.getAttribute('identifier') === id) || null;
        };
        // Helper to find a manifest <resource> element by an identifier (e.g., its corresponding <item>'s identifierref)
        const findManifestResourceElementByIentifier = (id) => {
            if (!id)
                return null;
            return Array.from(manifestFileContentParsed.getElementsByTagName('resource')).find(i => i.getAttribute('identifierRef') === id) || null;
        };
        // Map of resource items gathered from imsmanifest.xml
        const manifestFileContent = fileContents['imsmanifest.xml'];
        if (!manifestFileContent) {
            throw new Error("imsmanifest.xml not found in the archive.");
        }
        const manifestFileContentParsed = SHARED_PARSER.parseFromString(manifestFileContent, "application/xml");
        // Gather all manifest <resource> elements
        for (const manifestResourceElement of manifestFileContentParsed.getElementsByTagName("resource")) {
            const resourceIdentifier = manifestResourceElement.getAttribute("identifier");
            const resourceType = manifestResourceElement.getAttribute("type");
            const resourceHref = manifestResourceElement.getAttribute("href");
            let resourceStatus = 'unknown';
            let resourceTitle = 'untitled';
            let resourceAnalysisHref = null;
            let resourceAnalysisType = 'html';
            const isAssignment = resourceType.includes('associatedcontent/imscc_xmlv1p1/learning-application-resource') && resourceHref && resourceHref.endsWith('html') && !resourceHref.startsWith('course_settings/');
            const isQuizOrSurvey = resourceType.includes('imsqti_xmlv1p2/imscc_xmlv1p1/assessment');
            const isDiscussion = resourceType.includes('imsdt_xmlv1p1');
            const isPage = resourceType === 'webcontent' && resourceHref && resourceHref.startsWith('wiki_content/');
            const isFile = resourceType === 'webcontent' && resourceHref && resourceHref.startsWith('web_resources/');
            const isLink = resourceType.includes('imswl_xmlv1p1');
            let resourceClarifiedType = 'tbd';
            let resourceIdentifierRef = null;
            if (isLink) {
                resourceClarifiedType = 'link';
            }
            else if (isFile) {
                resourceClarifiedType = 'file';
            }
            else if (isPage) {
                resourceClarifiedType = 'page';
                const pageContent = fileContents[resourceHref];
                if (pageContent) {
                    const pageDoc = SHARED_PARSER.parseFromString(pageContent, "text/html");
                    resourceTitle = pageDoc.querySelector('title')?.textContent || resourceTitle;
                    resourceStatus = pageDoc.querySelector('meta[name="workflow_state"]')?.getAttribute('content') === 'active' ? 'active' : 'unpublished';
                }
                resourceAnalysisHref = resourceHref;
            }
            else if (isAssignment) {
                resourceClarifiedType = 'assignment';
                const assignmentSettingsPath = Object.keys(fileContents).find(fileName => fileName.startsWith(`${resourceIdentifier}/`) && fileName.endsWith('assignment_settings.xml'));
                if (assignmentSettingsPath) {
                    const settingsDoc = SHARED_PARSER.parseFromString(fileContents[assignmentSettingsPath], "application/xml");
                    resourceStatus = settingsDoc.querySelector('workflow_state')?.textContent === 'active' ? 'active' : 'unpublished';
                    resourceTitle = settingsDoc.querySelector('title')?.textContent || resourceTitle;
                }
                const assignmentHtmlPath = Object.keys(fileContents).find(fileName => fileName.startsWith(`${resourceIdentifier}/`) && fileName.endsWith('.html'));
                if (assignmentHtmlPath)
                    resourceAnalysisHref = assignmentHtmlPath;
            }
            else if (isQuizOrSurvey) {
                const resourceIdentifierRef = manifestResourceElement.querySelector('dependency')?.getAttribute("identifierRef");
                const matchingManifestResourceElement = findManifestResourceElementByIentifier(resourceIdentifierRef);
                if (matchingManifestResourceElement && fileContents[matchingManifestResourceElement.getAttribute('href')]) {
                    resourceAnalysisHref = matchingManifestResourceElement.getAttribute('href');
                    resourceAnalysisType = 'xml';
                    const itemMetaDoc = SHARED_PARSER.parseFromString(fileContents[resourceAnalysisHref], "application/xml");
                    if (itemMetaDoc) {
                        resourceTitle = itemMetaDoc.querySelector('title')?.textContent || resourceTitle;
                        resourceStatus = itemMetaDoc.querySelector('available')?.textContent === 'true' ? 'active' : 'unpublished';
                    }
                    const quizType = itemMetaDoc.querySelector('quiz_type')?.textContent;
                    if (quizType === 'survey') {
                        resourceClarifiedType = 'survey';
                    }
                    else {
                        resourceClarifiedType = 'quiz';
                    }
                }
            }
            else if (isDiscussion) {
                resourceClarifiedType = 'discussion';
                const discussionXmlPath = `${resourceIdentifier}.xml`;
                if (fileContents[discussionXmlPath]) {
                    resourceAnalysisHref = discussionXmlPath;
                    resourceAnalysisType = 'discussion_xml';
                    const discussionDoc = SHARED_PARSER.parseFromString(fileContents[discussionXmlPath], "application/xml");
                    resourceTitle = discussionDoc.querySelector('title')?.textContent || resourceTitle;
                    const resourceIdentifierRef = manifestResourceElement.querySelector('dependency')?.getAttribute("identifierRef");
                    const matchingManifestResourceElement = findManifestResourceElementByIentifier(resourceIdentifierRef);
                    if (matchingManifestResourceElement && fileContents[matchingManifestResourceElement.getAttribute('href')]) {
                        const settingsHref = matchingManifestResourceElement.getAttribute('href');
                        const itemSettingsDoc = SHARED_PARSER.parseFromString(fileContents[settingsHref], "application/xml");
                        if (itemSettingsDoc) {
                            resourceStatus = itemSettingsDoc.querySelector('workflow_state')?.textContent === 'active' ? 'active' : 'unpublished';
                        }
                        const discussionType = itemSettingsDoc.querySelector('type')?.textContent;
                        if (discussionType === 'announcement') {
                            resourceClarifiedType = 'announcement';
                        }
                    }
                }
            }
            allResources.push({
                identifier: resourceIdentifier,
                title: resourceTitle,
                identifierref: resourceIdentifierRef,
                status: resourceStatus,
                clarifiedType: resourceClarifiedType,
                contentType: resourceType,
                analysisHref: resourceAnalysisHref,
                analysisType: resourceAnalysisType,
            });
        }
        // Gather modules and module contents
        const metaModuleFileContent = fileContents['course_settings/module_meta.xml'];
        if (!metaModuleFileContent) {
            throw new Error("course_settings/module_meta.xml not found in the archive.");
        }
        const moduleMetaFileContentParsed = SHARED_PARSER.parseFromString(metaModuleFileContent, "application/xml");
        const metaModuleElements = Array.from(moduleMetaFileContentParsed.querySelectorAll("module"));
        metaModuleElements.forEach(metaModuleElement => {
            const moduleItems = [];
            const moduleTitle = metaModuleElement.querySelector('title')?.textContent || 'Untitled Module';
            const moduleStatus = metaModuleElement.querySelector('workflow_state')?.textContent === 'active' ? 'active' : 'unpublished';
            const metaModuleItemElements = Array.from(metaModuleElement.querySelectorAll('item'));
            metaModuleItemElements.forEach(metaModuleItemElement => {
                const moduleItemIdentifier = metaModuleItemElement.getAttribute('identifier');
                const indent = parseInt(metaModuleItemElement.querySelector('indent')?.textContent || '0', 10);
                const status = metaModuleItemElement.querySelector('workflow_state')?.textContent || 'unknown';
                const contentType = metaModuleItemElement.querySelector('content_type')?.textContent || 'unknown';
                const title = metaModuleItemElement.querySelector('title')?.textContent;
                const moduleItemIdentifierRef = metaModuleItemElement.querySelector('identifierref')?.textContent;
                let clarifiedType = 'tbd';
                const matchingResource = allResources.find(r => r.identifier === moduleItemIdentifierRef);
                clarifiedType = matchingResource?.clarifiedType || clarifiedType;
                const moduleItem = {
                    identifier: moduleItemIdentifier,
                    title,
                    identifierRef: moduleItemIdentifierRef,
                    moduleTitle: moduleTitle,
                    status,
                    indent,
                    clarifiedType,
                    contentType
                };
                moduleItems.push(moduleItem);
                // Building our list of in-module items
                inModuleResourceIdentifiers.add(moduleItemIdentifier);
            });
            const module = {
                title: moduleTitle,
                items: moduleItems,
                status: moduleStatus
            };
            allModules.push(module);
        });
        displayModules(allModules);
        displayCourseContent(allResources);
        updateProgress(95, 'Analyzing course content...');
        // TODO: I'm here! So close! 
        // await analyzeContent(fileContents, contentItemsForAnalysis);
        analyzeContent({ string: "Test" }, []);
        updateProgress(100, 'Analysis complete!');
        loadingSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        /* =========================================================================
           UI: Course Structure & Content display
           (keeps markup and interaction identical to original)
           ========================================================================= */
        /**
         * Return icon & label given a clarified type.
         * Kept implementation and SVGs identical to original to avoid behavioral changes.
         */
        // TODO: These likely need to be refactored
        function getItemTypeDetails(type) {
            const iconClass = "w-5 h-5 mr-3 text-gray-500 flex-shrink-0";
            let details = {
                icon: `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`,
                label: 'File'
            };
            if (type === 'contextmodulesubheader') {
                details.label = 'Header';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg>`;
            }
            else if (type === 'assignment') {
                details.label = 'Assignment';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>`;
            }
            else if (type === 'page') {
                details.label = 'Page';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
            }
            else if (type === 'externalurl') {
                details.label = 'Link';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>`;
            }
            else if (type === 'survey') {
                details.label = 'Survey';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>`;
            }
            else if (type === 'quiz') {
                details.label = 'Quiz';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
            }
            else if (type === 'announcement') {
                details.label = 'Announcement';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-2.236 9.168-5.518l-2.168 1.558a6.002 6.002 0 00-4.5 3.468V13a3 3 0 00-3-3H5.436z"></path></svg>`;
            }
            else if (type === 'discussion') {
                details.label = 'Discussion';
                details.icon = `<svg class="${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>`;
            }
            return details;
        }
        /**
         * Create badge components
        */
        function createBadge(text, colorString) {
            const newSpan = document.createElement('span');
            newSpan.textContent = text;
            let classNames = 'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium inset-ring ';
            switch (colorString) {
                case 'blue':
                    classNames += 'bg-blue-400/10 text-blue-400 inset-ring-blue-400/30';
                    break;
                case 'red':
                    classNames += 'bg-red-400/10 text-red-400 inset-ring-red-400/20';
                    break;
                case 'green':
                    classNames += 'bg-green-400/10 text-green-500 inset-ring-green-500/20';
                    break;
                case 'yellow':
                    classNames += 'bg-yellow-400/10 text-yellow-500 inset-ring-yellow-400/20';
                    break;
                case 'indigo':
                    classNames += 'bg-indigo-400/10 text-indigo-400 inset-ring-indigo-400/30';
                    break;
                case 'purple':
                    classNames += 'bg-purple-400/10 text-purple-400 inset-ring-purple-400/30';
                    break;
                case 'pink':
                    classNames += 'bg-pink-400/10 text-pink-400 inset-ring-pink-400/20';
                    break;
                case 'gray':
                default:
                    classNames += 'bg-gray-400/10 text-gray-400 inset-ring-gray-400/20';
            }
            ;
            newSpan.className = classNames;
            return newSpan.outerHTML;
        }
        const DEFAULT_BADGES = {
            impact: {
                critical: createBadge('Critical', 'red'),
                serious: createBadge('Serious', 'pink'),
                moderate: createBadge('Moderate', 'yellow'),
                minor: createBadge('Minor', 'blue'),
                info: createBadge('Info'),
            },
            status: {
                published: createBadge('Published', 'green'),
                unpublished: createBadge('Unpublished', 'red'),
            }
        };
        /**
         * Render the course structure accordion.
         * Implementation mirrors original behavior.
         */
        function displayModules(modules) {
            const container = document.getElementById('course-structure');
            container.innerHTML = '';
            if (!modules.length) {
                container.innerHTML = '<p class="text-gray-500">No course structure found in manifest.</p>';
                return;
            }
            modules.forEach(module => {
                const accordionDiv = document.createElement('div');
                accordionDiv.className = 'border border-gray-200 rounded-lg';
                const button = document.createElement('button');
                button.className = 'accordion-header w-full flex justify-between items-center p-4 text-left font-semibold text-gray-800 bg-gray-50 hover:bg-gray-100 focus:outline-none';
                const statusIndicator = module.status === 'active'
                    ? DEFAULT_BADGES.status.published
                    : DEFAULT_BADGES.status.unpublished;
                button.innerHTML = `
                        <span class="truncate pr-4">${module.title}</span>
                        <div class="flex items-center flex-shrink-0">
                            ${statusIndicator}
                            <svg class="w-5 h-5 transform transition-transform ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    `;
                const content = document.createElement('div');
                content.className = 'accordion-content bg-white';
                const innerContent = document.createElement('div');
                innerContent.className = 'p-4 border-t border-gray-200';
                const ul = document.createElement('ul');
                ul.className = 'space-y-3';
                module.items.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'flex items-center justify-between text-gray-700';
                    // Use numeric indent from module_meta.xml (safe default 0)
                    const rawIndent = item.indent; // Use the indent from the item directly
                    const indentLevel = Number.isFinite(rawIndent) ? Math.max(0, Math.floor(rawIndent)) : 0;
                    // Apply visual indentation (padding-left) so layout remains stable.
                    li.style.paddingLeft = `${indentLevel * 1.5}rem`;
                    // Get the correct type details from allCourseContent
                    const itemClarifiedType = item.clarifiedType || 'unspecified';
                    const typeDetails = getItemTypeDetails(itemClarifiedType);
                    const itemStatusIndicator = item.status === 'active'
                        ? DEFAULT_BADGES.status.published
                        : DEFAULT_BADGES.status.unpublished;
                    li.innerHTML = `
                            <div class="flex items-center flex-grow min-w-0">
                                ${typeDetails.icon}
                                <span class="truncate" title="${item.title}">${item.title}</span>
                            </div>
                            <div class="flex items-center flex-shrink-0 ml-4 space-x-2">
                                <span class="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-md">${typeDetails.label}</span>
                                ${itemStatusIndicator}
                            </div>
                        `;
                    ul.appendChild(li);
                });
                innerContent.appendChild(ul);
                content.appendChild(innerContent);
                accordionDiv.appendChild(button);
                accordionDiv.appendChild(content);
                container.appendChild(accordionDiv);
            });
            // Add accordion toggle functionality
            container.querySelectorAll('.accordion-header').forEach(button => {
                button.addEventListener('click', () => {
                    const content = button.nextElementSibling;
                    const icon = button.querySelector('svg');
                    if (content instanceof HTMLElement && icon) {
                        if (content.style.maxHeight) {
                            content.style.maxHeight = null;
                            icon.classList.remove('rotate-180');
                        }
                        else {
                            content.style.maxHeight = content.scrollHeight + "px";
                            icon.classList.add('rotate-180');
                        }
                    }
                });
            });
        }
        // TODO: Here
        /**
         * Render grouped course content accordion (by type).
         * Mirrors original implementation.     */
        // TODO: More robust type checking f0r contenItem
        function displayCourseContent(contentItems) {
            const container = document.getElementById('course-content-list');
            container.innerHTML = '';
            if (!contentItems.length) {
                container.innerHTML = '<p class="text-gray-500">No content items found.</p>';
                return;
            }
            const groupedByType = contentItems.reduce((acc, item) => {
                const typeLabel = getItemTypeDetails(item.clarifiedType).label;
                (acc[typeLabel] = acc[typeLabel] || []).push(item);
                return acc;
            }, {});
            // TODO: What is groupedByType?
            console.log(groupedByType);
            // TODO: What is items?
            for (const [type, items] of Object.entries(groupedByType)) {
                const accordionDiv = document.createElement('div');
                accordionDiv.className = 'border border-gray-200 rounded-lg';
                const button = document.createElement('button');
                button.className = 'accordion-header w-full flex justify-between items-center p-4 text-left font-semibold text-gray-800 bg-gray-50 hover:bg-gray-100 focus:outline-none';
                button.innerHTML = `
                        <span>${type} (${items.length})</span>
                        <svg class="w-5 h-5 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    `;
                const content = document.createElement('div');
                content.className = 'accordion-content bg-white';
                const innerContent = document.createElement('div');
                innerContent.className = 'p-4 border-t border-gray-200';
                const ul = document.createElement('ul');
                ul.className = 'space-y-3';
                // TODO: What is items?
                items.sort((a, b) => a.title.localeCompare(b.title)).forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'flex items-center justify-between text-gray-700 text-sm';
                    const statusIndicator = item.status === 'active' ? DEFAULT_BADGES.status.published : DEFAULT_BADGES.status.unpublished;
                    const moduleIndicator = item.inModule ? createBadge('In Module', 'blue') : createBadge('Not in Module', 'gray');
                    li.innerHTML = `
                            <span class="truncate" title="${item.title}">${item.title}</span>
                            <div class="flex items-center flex-shrink-0 ml-4 space-x-2">
                                ${moduleIndicator}
                                ${statusIndicator}
                            </div>
                        `;
                    ul.appendChild(li);
                });
                innerContent.appendChild(ul);
                content.appendChild(innerContent);
                accordionDiv.appendChild(button);
                accordionDiv.appendChild(content);
                container.appendChild(accordionDiv);
            }
            container.querySelectorAll('.accordion-header').forEach(button => {
                button.addEventListener('click', () => {
                    const content = button.nextElementSibling;
                    const icon = button.querySelector('svg');
                    // TODO: Just in case
                    if (content instanceof HTMLElement && icon) {
                        if (content.style.maxHeight) {
                            content.style.maxHeight = null;
                            icon.classList.remove('rotate-180');
                        }
                        else {
                            content.style.maxHeight = content.scrollHeight + "px";
                            icon.classList.add('rotate-180');
                        }
                    }
                });
            });
        }
        /* =========================================================================
           Content analysis (links, files, videos, accessibility)
           ========================================================================= */
        /**
         * Analyze provided items: extract links/files/videos and run accessibility checks.
         * items - items to analyze (with href and analysisType)
         */
        // Todo: More robust type checking for item
        async function analyzeContent(fileContents, items) {
            let allLinks = [], allFiles = [], allVideos = [];
            for (const item of items) {
                const content = fileContents[item.href];
                if (!content)
                    continue;
                let doc;
                if (item.analysisType === 'xml') {
                    const xmlDoc = SHARED_PARSER.parseFromString(content, "application/xml");
                    const description = xmlDoc.querySelector("description");
                    const htmlContent = description ? description.textContent : '';
                    doc = SHARED_PARSER.parseFromString(htmlContent, "text/html");
                }
                else if (item.analysisType === 'discussion_xml') {
                    const xmlDoc = SHARED_PARSER.parseFromString(content, "application/xml");
                    const text = xmlDoc.querySelector("text");
                    const htmlContent = text ? text.textContent : '';
                    doc = SHARED_PARSER.parseFromString(htmlContent, "text/html");
                }
                else {
                    doc = SHARED_PARSER.parseFromString(content, "text/html");
                }
                allLinks.push(...findLinks(doc, item));
                allFiles.push(...findFileAttachments(doc, item));
                allVideos.push(...findVideos(doc, item));
            }
            await runAndDisplayAccessibilityChecks(items, fileContents);
            await checkAndDisplayLinks(allLinks);
            displayFileAttachments(allFiles);
            displayVideos(allVideos);
        }
        /**
         * Run axe accessibility checks on items and prepare data for the accessibility tab.
         */
        // TODO: More robust type checking
        async function runAndDisplayAccessibilityChecks(items, fileContents) {
            let allResults;
            for (const item of items) {
                const content = fileContents[item.href];
                if (!content)
                    continue;
                let doc;
                if (item.analysisType === 'xml') {
                    const xmlDoc = SHARED_PARSER.parseFromString(content, "application/xml");
                    const description = xmlDoc.querySelector("description");
                    const htmlContent = description ? description.textContent : '';
                    doc = SHARED_PARSER.parseFromString(htmlContent, "text/html");
                }
                else if (item.analysisType === 'discussion_xml') {
                    const xmlDoc = SHARED_PARSER.parseFromString(content, "application/xml");
                    const text = xmlDoc.querySelector("text");
                    const htmlContent = text ? text.textContent : '';
                    doc = SHARED_PARSER.parseFromString(htmlContent, "text/html");
                }
                else {
                    doc = SHARED_PARSER.parseFromString(content, "text/html");
                }
                if (doc.body && doc.body.innerHTML.trim() !== '') {
                    try {
                        if (doc.body.querySelectorAll('*').length > 0) {
                            const axeOptions = {
                                preload: false,
                                runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
                            };
                            const results = await axe.run(doc.body.querySelectorAll('*'), axeOptions);
                            const addMetadata = (issue) => ({
                                ...issue,
                                itemTitle: item.title,
                                itemType: getItemTypeDetails(item.clarifiedType).label,
                                status: item.status,
                                moduleTitle: item.moduleTitle
                            });
                            allResults.violations.push(...results.violations.map(addMetadata));
                            allResults.passes.push(...results.passes.map(addMetadata));
                            allResults.incomplete.push(...results.incomplete.map(addMetadata));
                            allResults.inapplicable.push(...results.inapplicable.map(addMetadata));
                        }
                    }
                    catch (e) {
                        console.warn(`Accessibility scan skipped for ${item.title}: ${e.message}`);
                    }
                }
            }
            accessibilityData = allResults;
            setupAccessibilityTab(accessibilityData, items);
        }
        /* =========================================================================
           Accessibility tab: controls & rendering
           ========================================================================= */
        /**
         * Build the accessibility controls and wire up filters and sorting.
         */
        // TODO: More robust type checking - these are axe results
        function setupAccessibilityTab(results, allScannedItems) {
            const controlsContainer = document.getElementById('accessibility-controls');
            controlsContainer.innerHTML = '';
            // Create grid for filters
            const filterGrid = document.createElement('div');
            filterGrid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4';
            // 1. Result Type Filters
            const resultTypeContainer = document.createElement('div');
            resultTypeContainer.innerHTML = `<label class="block text-sm font-medium text-gray-700 mb-2">Show Results:</label>`;
            const resultTypeFilters = document.createElement('div');
            resultTypeFilters.id = 'result-type-filters';
            resultTypeFilters.className = 'flex flex-wrap gap-4';
            const categories = [
                { name: 'Violations', data: results.violations, color: 'red' },
                { name: 'Passes', data: results.passes, color: 'green' },
                { name: 'Incomplete', data: results.incomplete, color: 'yellow' }
            ];
            categories.forEach(cat => {
                const filterId = `filter-check-${cat.name.toLowerCase()}`;
                const filterWrapper = document.createElement('div');
                filterWrapper.className = 'flex items-center';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = filterId;
                checkbox.dataset.category = cat.name.toLowerCase();
                checkbox.className = 'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';
                if (cat.name === 'Violations')
                    checkbox.checked = true;
                const label = document.createElement('label');
                label.htmlFor = filterId;
                label.className = 'ml-2 flex items-center cursor-pointer';
                label.innerHTML = `${cat.name} ${cat.name === 'Incomplete' ? '(Manual Inspection Recommended)' : ''} &nbsp; ${createBadge(cat.data.length.toString(), 'purple')}`;
                filterWrapper.appendChild(checkbox);
                filterWrapper.appendChild(label);
                resultTypeFilters.appendChild(filterWrapper);
            });
            resultTypeContainer.appendChild(resultTypeFilters);
            filterGrid.appendChild(resultTypeContainer);
            // 2. Item Type Filters
            const allItemTypes = [...new Set([...results.violations, ...results.passes].map(r => r.itemType))];
            if (allItemTypes.length > 1) {
                const itemTypeContainer = document.createElement('div');
                itemTypeContainer.innerHTML = `<label class="block text-sm font-medium text-gray-700 mb-2">Filter by Item Type:</label>`;
                const itemTypeFilters = document.createElement('div');
                itemTypeFilters.id = 'item-type-filters';
                itemTypeFilters.className = 'flex flex-wrap gap-4';
                allItemTypes.forEach(type => {
                    const filterId = `filter-item-type-${type.replace(/\s+/g, '')}`;
                    const filterWrapper = document.createElement('div');
                    filterWrapper.className = 'flex items-center';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = filterId;
                    checkbox.dataset.itemType = type;
                    checkbox.className = 'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';
                    checkbox.checked = true;
                    const label = document.createElement('label');
                    label.htmlFor = filterId;
                    label.className = 'ml-2 flex items-center cursor-pointer text-sm';
                    label.textContent = type;
                    filterWrapper.appendChild(checkbox);
                    filterWrapper.appendChild(label);
                    itemTypeFilters.appendChild(filterWrapper);
                });
                itemTypeContainer.appendChild(itemTypeFilters);
                filterGrid.appendChild(itemTypeContainer);
            }
            // 3. Status Filters
            const statusContainer = document.createElement('div');
            statusContainer.innerHTML = `<label class="block text-sm font-medium text-gray-700 mb-2">Filter by Status:</label>`;
            const statusFilters = document.createElement('div');
            statusFilters.id = 'status-filters';
            statusFilters.className = 'flex flex-wrap gap-4';
            statusFilters.innerHTML = `
                    <div class="flex items-center">
                        <input id="filter-status-published" type="checkbox" data-status="active" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked>
                        <label for="filter-status-published" class="ml-2 text-sm">Published</label>
                    </div>
                    <div class="flex items-center">
                        <input id="filter-status-unpublished" type="checkbox" data-status="unpublished" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked>
                        <label for="filter-status-unpublished" class="ml-2 text-sm">Unpublished</label>
                    </div>
                `;
            statusContainer.appendChild(statusFilters);
            filterGrid.appendChild(statusContainer);
            // 4. Module Filters
            const moduleContainer = document.createElement('div');
            moduleContainer.innerHTML = `<label class="block text-sm font-medium text-gray-700 mb-2">Filter by Location:</label>`;
            const moduleFilters = document.createElement('div');
            moduleFilters.id = 'module-filters';
            moduleFilters.className = 'flex flex-wrap gap-4';
            moduleFilters.innerHTML = `
                    <div class="flex items-center">
                        <input id="filter-module-in" type="checkbox" data-in-module="true" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked>
                        <label for="filter-module-in" class="ml-2 text-sm">In a Module</label>
                    </div>
                    <div class="flex items-center">
                        <input id="filter-module-out" type="checkbox" data-in-module="false" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked>
                        <label for="filter-module-out" class="ml-2 text-sm">Not in a Module</label>
                    </div>
                `;
            moduleContainer.appendChild(moduleFilters);
            filterGrid.appendChild(moduleContainer);
            controlsContainer.appendChild(filterGrid);
            // 5. Sort control
            const sortContainer = document.createElement('div');
            sortContainer.innerHTML = `<label for="sort-select" class="block text-sm font-medium text-gray-700 mt-4">Sort by:</label>`;
            const select = document.createElement('select');
            select.id = 'sort-select';
            select.className = 'mt-1 block w-full md:w-1/4 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md';
            select.innerHTML = `
                    <option value="name-asc">Item Name (A-Z)</option>
                    <option value="name-desc">Item Name (Z-A)</option>
                `;
            sortContainer.appendChild(select);
            controlsContainer.appendChild(sortContainer);
            // Wire up events and render initial results
            controlsContainer.querySelectorAll('input[type="checkbox"], select').forEach(el => {
                el.addEventListener('change', renderAccessibilityResults);
            });
            renderAccessibilityResults();
            // Add debug accordion listing scanned items (mirrors original)
            const debugAccordion = createDebugAccordion(allScannedItems);
            document.getElementById('accessibility-results').appendChild(debugAccordion);
        }
        /**
         * Render accessibility results honoring filters and sort control.
         */
        function renderAccessibilityResults() {
            const resultsContainer = document.getElementById('accessibility-results');
            resultsContainer.innerHTML = '';
            const selectedResultTypes = Array.from(document.querySelectorAll('#result-type-filters input:checked')).map(cb => cb.dataset.category);
            const itemTypeFilters = document.querySelectorAll('#item-type-filters input');
            const selectedItemTypes = Array.from(itemTypeFilters).length > 0
                ? Array.from(itemTypeFilters).filter(cb => cb.checked).map(cb => cb.dataset.itemType)
                : null;
            const selectedStatuses = Array.from(document.querySelectorAll('#status-filters input:checked')).map(cb => cb.dataset.status);
            const inModule = document.getElementById('filter-module-in')?.checked;
            const notInModule = document.getElementById('filter-module-in')?.checked;
            let filteredResults = [];
            selectedResultTypes.forEach(type => {
                if (accessibilityData[type])
                    filteredResults.push(...accessibilityData[type]);
            });
            filteredResults = filteredResults.filter(result => {
                const itemTypeMatch = selectedItemTypes ? selectedItemTypes.includes(result.itemType) : true;
                const statusMatch = selectedStatuses.includes(result.status);
                const inModuleMatch = inModule && result.moduleTitle;
                const notInModuleMatch = notInModule && !result.moduleTitle;
                return itemTypeMatch && statusMatch && (inModuleMatch || notInModuleMatch);
            });
            const groupedByItem = filteredResults.reduce((acc, issue) => {
                (acc[issue.itemTitle] = acc[issue.itemTitle] || []).push(issue);
                return acc;
            }, {});
            // TODO: More robust type handling
            console.log(groupedByItem);
            const sortValue = document.getElementById('sort-select')?.value || 'name-asc';
            const sortedItemTitles = Object.keys(groupedByItem).sort((a, b) => {
                if (sortValue === 'name-asc')
                    return a.localeCompare(b);
                return b.localeCompare(a);
            });
            if (sortedItemTitles.length === 0) {
                resultsContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No results match the current filters.</p>';
                return;
            }
            sortedItemTitles.forEach(itemTitle => {
                const issues = groupedByItem[itemTitle];
                const itemAccordion = createItemAccordion(itemTitle, issues);
                resultsContainer.appendChild(itemAccordion);
            });
        }
        /**
         * Create an accordion block for a single item and its issues.
         */
        function createItemAccordion(itemTitle, issues) {
            const firstIssue = issues[0];
            const accordionDiv = document.createElement('div');
            accordionDiv.className = 'border border-gray-200 rounded-lg';
            const button = document.createElement('button');
            button.className = 'accordion-header w-full flex justify-between items-center p-3 text-left text-sm font-medium text-gray-800 bg-gray-50 hover:bg-gray-100 focus:outline-none';
            const itemStatusIndicator = firstIssue.status === 'active'
                ? DEFAULT_BADGES.status.published
                : DEFAULT_BADGES.status.unpublished;
            button.innerHTML = `
                <div class="flex-grow min-w-0">
                    <p class="truncate font-semibold">${itemTitle}</p>
                    <p class="text-xs text-gray-500 truncate">Module: ${firstIssue.moduleTitle || 'N/A'}</p>
                </div>
                <div class="flex items-center flex-shrink-0 ml-4 space-x-2">
                    <span class="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-md">${firstIssue.itemType}</span>
                    ${itemStatusIndicator}
                    <svg class="w-5 h-5 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            `;
            const content = document.createElement('div');
            content.className = 'accordion-content bg-white';
            const innerContent = document.createElement('div');
            innerContent.className = 'p-4 border-t border-gray-200 space-y-2';
            issues.forEach(issue => {
                const issueAccordion = createIssueAccordion(issue);
                innerContent.appendChild(issueAccordion);
            });
            content.appendChild(innerContent);
            accordionDiv.appendChild(button);
            accordionDiv.appendChild(content);
            button.addEventListener('click', () => {
                const icon = button.querySelector('svg');
                if (content && icon) {
                    if (content.style.maxHeight) {
                        content.style.maxHeight = null; // Collapse
                        icon.classList.remove('rotate-180');
                    }
                    else {
                        content.style.maxHeight = 'none'; // Expand to fit content
                        icon.classList.add('rotate-180');
                    }
                }
            });
            return accordionDiv;
        }
        /**
         * Create an accordion for a single accessibility issue.
         */
        function createIssueAccordion(issue) {
            const accordionDiv = document.createElement('div');
            accordionDiv.className = 'border border-gray-200 rounded-lg';
            const button = document.createElement('button');
            button.className = 'accordion-header w-full flex justify-between items-center p-2 text-left text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 focus:outline-none';
            button.innerHTML = `
                    <span class="truncate pr-4">${_.escape(issue.help)}</span>
                    <div class="flex items-center flex-shrink-0 ml-4">
                        ${DEFAULT_BADGES.impact[issue.impact] || ''}
                        <svg class="w-4 h-4 transform transition-transform ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                `;
            const content = document.createElement('div');
            content.className = 'accordion-content bg-white';
            const innerContent = document.createElement('div');
            innerContent.className = 'p-3 border-t border-gray-200 text-xs space-y-2';
            // Safe access for nodes array to avoid undefined errors
            const nodeHtml = (issue.nodes && issue.nodes[0] && issue.nodes[0].html) ? issue.nodes[0].html.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
            const nodeTargets = (issue.nodes && issue.nodes[0] && issue.nodes[0].target) ? issue.nodes[0].target.join(', ') : '';
            innerContent.innerHTML = `
                    <div>
                        <p class="font-semibold text-gray-800">Description:</p>
                        <p class="text-gray-600">${_.escape(issue.description)}</p>
                    </div>
                    <div>
                        <p class="font-semibold text-gray-800">Affected Element:</p>
                        <pre class="bg-gray-100 p-2 rounded-md text-xs overflow-x-auto"><code>${nodeHtml}</code></pre>
                    </div>
                     <div>
                        <p class="font-semibold text-gray-800">CSS Selector:</p>
                        <p class="text-gray-600 font-mono">${nodeTargets}</p>
                    </div>
                    <a href="${issue.helpUrl}" target="_blank" class="text-indigo-600 hover:underline font-semibold">Learn More &rarr;</a>
                `;
            content.appendChild(innerContent);
            accordionDiv.appendChild(button);
            accordionDiv.appendChild(content);
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const icon = button.querySelector('svg');
                if (content && icon) {
                    if (content.style.maxHeight) {
                        content.style.maxHeight = null;
                        icon.classList.remove('rotate-180');
                    }
                    else {
                        content.style.maxHeight = content.scrollHeight + "px";
                        icon.classList.add('rotate-180');
                    }
                }
            });
            return accordionDiv;
        }
        /**
         * Create debug accordion listing scanned items (keeps original behavior).
         */
        // TODO: More robust type checking - these are for accessibility scan
        function createDebugAccordion(scannedItems) {
            const accordionDiv = document.createElement('div');
            accordionDiv.className = 'border border-gray-200 rounded-lg mt-4';
            const button = document.createElement('button');
            button.className = 'accordion-header w-full flex justify-between items-center p-3 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none';
            button.innerHTML = `
                    <span>Items Scanned for Accessibility (${scannedItems.length})</span>
                    <svg class="w-5 h-5 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                `;
            const content = document.createElement('div');
            content.className = 'accordion-content bg-white';
            const innerContent = document.createElement('div');
            innerContent.className = 'p-4 border-t border-gray-200 max-h-48 overflow-y-auto';
            const ul = document.createElement('ul');
            ul.className = 'list-disc list-inside text-sm text-gray-600';
            scannedItems.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item.title;
                ul.appendChild(li);
            });
            innerContent.appendChild(ul);
            content.appendChild(innerContent);
            accordionDiv.appendChild(button);
            accordionDiv.appendChild(content);
            button.addEventListener('click', () => {
                const icon = button.querySelector('svg');
                if (content && icon) {
                    if (content.style.maxHeight) {
                        content.style.maxHeight = null;
                        icon.classList.remove('rotate-180');
                    }
                    else {
                        content.style.maxHeight = content.scrollHeight + "px";
                        icon.classList.add('rotate-180');
                    }
                }
            });
            return accordionDiv;
        }
        /* =========================================================================
           Link, file attachment, video discovery & display
           ========================================================================= */
        /**
         * Display results for external link inventory.
         * Note: original code simulated link checks due to CORS; preserved here.
         */
        async function checkAndDisplayLinks(links) {
            const container = document.getElementById('link-inventory-results');
            // TODO: Add this back
            const summaryContainer = document.getElementById('link-summary');
            if (links.length > 0) {
                container.innerHTML = '';
            }
            else {
                return;
            }
            // Create filter UI
            const filterContainer = document.createElement('div');
            filterContainer.innerHTML = `<label class="block text-sm font-medium text-gray-700 mb-2">Filter by Link Type:</label>`;
            const filterCheckboxes = document.createElement('div');
            filterCheckboxes.id = 'link-type-filters';
            filterCheckboxes.className = 'flex flex-wrap gap-4';
            LINK_TYPES.forEach(type => {
                const filterId = `filter-link-type-${type.replace(/\s+/g, '')}`;
                const filterWrapper = document.createElement('div');
                filterWrapper.className = 'flex items-center';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = filterId;
                checkbox.dataset.type = type;
                checkbox.className = 'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';
                checkbox.checked = true; // Check all by default
                const label = document.createElement('label');
                label.htmlFor = filterId;
                label.className = 'ml-2 flex items-center cursor-pointer';
                label.textContent = type == 'osu' ? 'OSU' : `${type.charAt(0).toUpperCase()}${type.substring(1)}`;
                label.innerHTML += `&nbsp; ${createBadge(links.filter(l => l.type == type).length.toString(), 'purple')}`;
                filterWrapper.appendChild(checkbox);
                filterWrapper.appendChild(label);
                filterCheckboxes.appendChild(filterWrapper);
            });
            filterContainer.appendChild(filterCheckboxes);
            container.appendChild(filterContainer);
            // Function to display links
            const displayLinks = (filteredLinks) => {
                let contentDiv = container.querySelector('.space-y-3');
                if (!contentDiv) {
                    contentDiv = document.createElement('div');
                    contentDiv.className = 'space-y-3';
                    container.appendChild(contentDiv);
                }
                contentDiv.innerHTML = ''; // Clear previous links
                if (filteredLinks.length === 0) {
                    contentDiv.innerHTML = '<p class="text-gray-500">No links found for the selected types.</p>';
                    return;
                }
                const linkTypeBadges = {
                    osu: createBadge('OSU', 'red'),
                    external: createBadge('External', 'blue'),
                    course: createBadge('Course', 'yellow'),
                };
                for (const link of filteredLinks) {
                    const linkDiv = document.createElement('div');
                    linkDiv.className = 'p-3 rounded-md bg-gray-50 flex items-start space-x-3';
                    linkDiv.innerHTML = `
                    <div class="flex-grow min-w-0">
                        <p class="font-medium text-gray-800 truncate" title="${link.text}">${link.text}</p>
                        <p aria-description="link type">${linkTypeBadges[link.type]}</p>
                        <p class="text-sm text-gray-500"><strong>Target</strong>: <a href="${link.url}" target="_blank"><u>${link.url}</u></a></p>
                        <p class="text-sm text-gray-500"><strong>Found in</strong>: ${link.itemTitle}</p>
                    </div>
                `;
                    contentDiv.appendChild(linkDiv);
                }
            };
            // Filter links based on selected types
            const filterLinks = () => {
                const selectedTypes = Array.from(filterCheckboxes.querySelectorAll('input:checked')).map(cb => cb.dataset.type);
                const filteredLinks = selectedTypes.length === 0 ? [] : links.filter(link => selectedTypes.includes(link.type));
                displayLinks(filteredLinks);
            };
            filterCheckboxes.querySelectorAll('input').forEach(checkbox => {
                checkbox.addEventListener('change', filterLinks);
            });
            // Initial display of links
            filterLinks();
        }
        /**
         * Display file attachments found in content.
         */
        function displayFileAttachments(files) {
            const container = document.getElementById('file-attachment-results');
            const summaryContainer = document.getElementById('file-attachment-summary');
            summaryContainer.innerHTML = `Attachments found: &nbsp; ${createBadge(files.length.toString(), 'purple')}`;
            if (files.length === 0) {
                container.innerHTML = '<p class="text-gray-500">No file attachments found.</p>';
                return;
            }
            container.innerHTML = '';
            files.forEach(file => {
                const liDiv = document.createElement('li');
                liDiv.className = 'p-3 rounded-md bg-gray-50 flex items-start space-x-3';
                liDiv.innerHTML = `
                <div class="flex-grow min-w-0">
                    <p class="font-medium text-gray-800 truncate" title="${file.text}">${file.text}</p>
                    ${createBadge(capitalize(file.itemType))}
                    <p class="text-sm text-gray-500"><strong>In Item</strong>: ${file.itemTitle}</p>
                    <p class="text-sm text-gray-500"><strong>In Module</strong>: ${file.itemModule}</p>
                </div>
            `;
                container.appendChild(liDiv);
            });
        }
        /**
         * Display video findings (platform & transcript presence).
         */
        function displayVideos(videos) {
            const container = document.getElementById('video-results');
            const summaryContainer = document.getElementById('video-summary');
            const withTranscript = videos.filter(v => v.hasTranscript).length;
            const withoutTranscript = videos.length - withTranscript;
            summaryContainer.innerHTML = `
                    ${createBadge(`${withTranscript} transcript detected`, 'green')}
                    ${createBadge(`${withoutTranscript} transcript not detected`, 'yellow')}
                `;
            if (videos.length === 0) {
                container.innerHTML = '<p class="text-gray-500">No embedded videos found.</p>';
                return;
            }
            container.innerHTML = '';
            const ul = document.createElement('ul');
            ul.className = 'space-y-3';
            videos.forEach(video => {
                const li = document.createElement('li');
                li.className = 'p-3 bg-gray-50 rounded-md flex items-center space-x-3';
                const statusIcon = video.hasTranscript
                    ? `<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
                    : `<svg class="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
                li.innerHTML = `
                        <div>${statusIcon}</div>
                        <div>
                            <p class="font-medium text-gray-800">${video.platform} Video</p>
                            <p class="text-sm text-gray-500">Found in: ${video.itemTitle}</p>
                        </div>
                    `;
                ul.appendChild(li);
            });
            container.appendChild(ul);
        }
        /* =========================================================================
           Content parsing helpers (links/files/videos
           ========================================================================= */
        /**
         * Find external links in a document and return structured items.
         */
        // TODO: More robust type checking for item
        function findLinks(doc, item) {
            const links = Array();
            if (!doc || !doc.querySelectorAll)
                return links;
            doc.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('mailto') && !a.classList.contains('instructure_file_link') && !a.classList.contains('instructure_scribd_file')) {
                    let type = 'unknown';
                    if (href.startsWith('$CANVAS') || href.includes('$WIKI_REFERENCE$')) {
                        type = 'course';
                    }
                    else if (href.includes('.osu.edu') || href.includes('.ohio-state.edu')) {
                        type = 'osu';
                    }
                    else {
                        type = 'external';
                    }
                    links.push({ url: href, text: a.textContent.trim(), itemTitle: item.title, type: type });
                }
            });
            return links;
        }
        /**
         * Find file attachment links in a document.
         */
        // TODO: More robust type checking
        function findFileAttachments(doc, item) {
            const files = [];
            if (!doc || !doc.querySelectorAll)
                return files;
            doc.querySelectorAll('a.instructure_file_link, a.instructure_scribd_file').forEach(a => {
                files.push({
                    text: a.textContent.trim(),
                    itemType: item.clarifiedType,
                    itemModule: item.inModule ? item.moduleTitle : '(None)',
                    itemTitle: item.title, href: a.href
                });
            });
            return files;
        }
        /**
         * Find embedded iframes that correspond to supported video platforms.
         */
        // TODO: More robust type checking
        function findVideos(doc, item) {
            const videos = Array();
            if (!doc || !doc.querySelectorAll)
                return videos;
            doc.querySelectorAll('iframe').forEach(iframe => {
                const src = (iframe.src || '').toLowerCase();
                let platform = 'Unknown';
                if (src.includes('youtube.com') || src.includes('youtu.be'))
                    platform = 'YouTube';
                else if (src.includes('vimeo.com'))
                    platform = 'Vimeo';
                else if (src.includes('mediasite.com'))
                    platform = 'Mediasite';
                else if (src.includes('echo360.com'))
                    platform = 'Echo360';
                else if (src.includes('panopto.com'))
                    platform = 'Panopto';
                if (platform !== 'Unknown') {
                    const adjacentText = (iframe.previousSibling?.textContent || '') + ' ' + (iframe.nextSibling?.textContent || '');
                    const hasTranscript = /transcript|caption/i.test(adjacentText);
                    videos.push({ platform, src: iframe.src, hasTranscript, itemTitle: item.title });
                }
            });
            return videos;
        }
        /* =========================================================================
           End DOMContentLoaded
           ========================================================================= */
    }
});
export {};
//# sourceMappingURL=main.js.map