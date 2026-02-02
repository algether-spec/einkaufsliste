#!/bin/bash
VERSION=$(cat .gitversion)
IFS='.' read -r major minor patch <<< "$VERSION"
patch=$((patch + 1))
NEW_VERSION="$major.$minor.$patch"
echo $NEW_VERSION > .gitversion
echo $NEW_VERSION
