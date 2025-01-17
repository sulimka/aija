'use strict';

import plugins       from 'gulp-load-plugins';
import yargs         from 'yargs';
import browser       from 'browser-sync';
import gulp          from 'gulp';
import rimraf        from 'rimraf';
import yaml          from 'js-yaml';
import fs            from 'fs';
import webpackStream from 'webpack-stream';
import webpack2      from 'webpack';
import named         from 'vinyl-named';
import log           from 'fancy-log';
import colors        from 'ansi-colors';
import { dateFormat } from 'date-format-helper';
import phpcs         from 'gulp-phpcs';
import fileinclude   from 'gulp-file-include';

// Load all Gulp plugins into one variable
const $ = plugins();

// Check for --production flag
const PRODUCTION = !!(yargs.argv.production);

// Check for --development flag unminified with sourcemaps
const DEV = !!(yargs.argv.development);

// Load settings from settings.yml
const { BROWSERSYNC, COMPATIBILITY, REVISIONING, PATHS } = loadConfig();

// Check if file exists synchronously
function checkFileExists(filepath) {
  let flag = true;
  try {
    fs.accessSync(filepath, fs.F_OK);
  } catch(e) {
    flag = false;
  }
  return flag;
}

// Load default or custom YML config file
function loadConfig() {
  log('Loading config file...');

  if (checkFileExists('config.yml')) {
    // config.yml exists, load it
    log(colors.bold(colors.cyan('config.yml')), 'exists, loading', colors.bold(colors.cyan('config.yml')));
    let ymlFile = fs.readFileSync('config.yml', 'utf8');
    return yaml.load(ymlFile);

  } else if(checkFileExists('config-default.yml')) {
    // config-default.yml exists, load it
    log(colors.bold(colors.cyan('config.yml')), 'does not exist, loading', colors.bold(colors.cyan('config-default.yml')));
    let ymlFile = fs.readFileSync('config-default.yml', 'utf8');
    return yaml.load(ymlFile);

  } else {
    // Exit if config.yml & config-default.yml do not exist
    log('Exiting process, no config file exists.');
    log('Error Code:', err.code);
    process.exit(1);
  }
}

// Delete the "dist" folder
// This happens every time a build starts
function clean(done) {
  rimraf(PATHS.dist, done);
  log( 'Folder ', colors.bold(colors.cyan('/dist')), 'is DELETED...' );
}

// Copy files out of the assets folder
// This task skips over the "images", "js", and "scss" folders, which are parsed separately
function copy() {
  return gulp.src(PATHS.assets)
    .pipe(gulp.dest(PATHS.dist + '/assets'));
}

// Compile Sass into CSS
// In production, the CSS is compressed
function sass() {
  return gulp.src([
    'src/assets/scss/main.scss',
   // 'src/assets/scss/admin.scss',
   // 'src/assets/scss/editor.scss'
  ])
    .pipe($.sourcemaps.init())
    .pipe(
      $.sass.sync({
        outputStyle: 'compressed'
      })
        .on('error', $.sass.logError)
    )
    // .pipe(sourcemaps.write())
    .pipe(
      $.sass({
        includePaths: PATHS.sass
      })
        .on('error', $.sass.logError)
    )
    .pipe($.autoprefixer({
      overrideBrowserslist: COMPATIBILITY,
      flexbox: "no-2009",
      grid: "autoplace"
    }))

    .pipe($.if(PRODUCTION, $.cleanCss({ compatibility: 'ie9' })))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe($.if(REVISIONING && PRODUCTION || REVISIONING && DEV, $.rev()))
    .pipe(gulp.dest(PATHS.dist + '/assets/css'))
    .pipe($.if(REVISIONING && PRODUCTION || REVISIONING && DEV, $.rev.manifest()))
    .pipe(gulp.dest(PATHS.dist + '/assets/css'))
    .pipe(browser.reload({ stream: true }));
}

// Compile HTML template part file to one file
function compileHtml() {
  return gulp.src([
    PATHS.htmlAssets
  ])
    .pipe(fileinclude({
      prefix: '@@',
      basepath: '@file'
    }))
    .pipe(gulp.dest(PATHS.dist))
    .pipe(browser.reload({ stream: true }));
}

// Combine JavaScript into one file
// In production, the file is minified
const webpack = {
  config: {
    mode: ($.if(PRODUCTION,  'production', 'development') ),
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          loader: 'babel-loader',
          exclude: /node_modules(?![\\\/]foundation-sites)/,
        },
      ],
    },
    externals: {
      jquery: 'jQuery',
    },
  },

  changeHandler(err, stats) {
    log('[webpack]', stats.toString({
      colors: true,
    }));

    //browser.reload();
  },

  build() {
    return gulp.src(PATHS.entries)
      .pipe(named())
      .pipe(webpackStream(webpack.config, webpack2)
        .on('error', (err) => {
          log('[webpack:error]', err.toString({
            colors: true,
          }));
        }),
      )
      .pipe($.if(PRODUCTION, $.uglify().on('error', e => { console.log(e); }), ))
      .pipe($.if(REVISIONING && PRODUCTION || REVISIONING && DEV, $.rev()))
      .pipe(gulp.dest(PATHS.dist + '/assets/js'))
      .pipe($.if(REVISIONING && PRODUCTION || REVISIONING && DEV, $.rev.manifest()))
      .pipe(gulp.dest(PATHS.dist + '/assets/js'));
  },

  watch() {
    const watchConfig = Object.assign(webpack.config, {
      watch: true, // TODO: [DEP_WEBPACK_WATCH_WITHOUT_CALLBACK]
      devtool: 'inline-source-map',
      watchOptions: {
        ignored: ["node_modules/**"],
      },
    });

    return gulp.src(PATHS.entries)
      .pipe(named())
      .pipe(webpackStream(watchConfig, webpack2, webpack.changeHandler)
        .on('error', (err) => {
          log('[webpack:error]', err.toString({
            colors: true,
          }));
        }),
      )
      .pipe(gulp.dest(PATHS.dist + '/assets/js'));
  },
};

gulp.task('webpack:build', webpack.build);
gulp.task('webpack:watch', webpack.watch);

// Copy images to the "dist" folder
// In production, the images are compressed
function images() {
  return gulp.src('src/assets/images/**/*')
    .pipe($.if(PRODUCTION, $.imagemin([
      // Compress PNG images, lossless
      $.imagemin.optipng({
        optimizationLevel: 5,
      }),
      // Compress GIF images, lossless
      $.imagemin.gifsicle({
        interlaced: true,
      }),
      // Compress JPEG images, lossy
      $.imagemin.mozjpeg({
        quality: 75,
        progressive: true
      }),
      // Compress SVG images, lossless
      $.imagemin.svgo({
        plugins: [
          {cleanupAttrs: true},
          {removeComments: true},
        ]
      })
    ], {
      verbose: true
    })))
    .pipe(gulp.dest(PATHS.dist + '/assets/images'));
}

// Create a .zip archive of the theme
function archive() {
  let time = dateFormat({t: new Date(), format: 'YYYY-MM-DD_hh-mm'});
  let pkg = JSON.parse(fs.readFileSync('./package.json'));
  let title = pkg.name + '_' + time + '.zip';

  return gulp.src(PATHS.package)
    .pipe($.zip(title))
    .pipe(gulp.dest('packaged'));
}

// PHP Code Sniffer task
gulp.task('phpcs', function() {
  return gulp.src(PATHS.phpcs)
    // Validate files using PHP Code Sniffer
    .pipe($.phpcs({
      bin: 'vendor/bin/phpcs',
      standard: './codesniffer.ruleset.xml', // PSR2 or ./codesniffer.ruleset.xml
      warningSeverity: 0,
      showSniffCode: true,
    }))
    // Log all problems that was found
    .pipe($.phpcs.reporter('log'));
});


// Start BrowserSync to preview the site in
function server(done) {
  browser.init({
    proxy: BROWSERSYNC.url,

    ui: {
      port: 8080
    },

  });
  done();
}

// Reload the browser with BrowserSync
function reload(done) {
  browser.reload();
  done();
}

// Watch for changes to static assets, pages, Sass, and JavaScript
function watch() {
  gulp.watch(PATHS.assets, copy);
  gulp.watch('src/assets/scss/**/*.scss', sass)
    .on('change', path => log('File ' + colors.bold(colors.magenta(path)) + ' changed.'))
    .on('unlink', path => log('File ' + colors.bold(colors.magenta(path)) + ' was removed.'));
  gulp.watch('**/*.php')
    .on('change', path => log('File ' + colors.bold(colors.magenta(path)) + ' changed.'))
    .on('unlink', path => log('File ' + colors.bold(colors.magenta(path)) + ' was removed.'));
  //gulp.watch('**/*.html', compileHtml);
  gulp.watch('src/assets/images/**/*', gulp.series(images));
}

function watchHtml() {
  gulp.watch('**/*.html', compileHtml);
}

// Build the "dist" folder by running all of the below tasks
gulp.task('build', gulp.series(clean, gulp.parallel(sass, compileHtml, 'webpack:build', images, copy)));

// Build the site, run the server, and watch for file changes
gulp.task('html', gulp.series(gulp.parallel(watchHtml)));

// Build the site, run the server, and watch for file changes
gulp.task('default', gulp.series('build', gulp.parallel('webpack:watch', watch, watchHtml)));

// Package task
gulp.task('package', gulp.series('build', archive));
