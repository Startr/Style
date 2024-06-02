#!/bin/bash
# Version 1.3

# Copyright (c) Startr LLC. All rights reserved.
# This script is licensed under the GNU Affero General Public License v3.0.
# For more information, see https://www.gnu.org/licenses/agpl-3.0.en.html

# Startr OpenCo™ Build Script

# PLATFORM variable can be set via the first script argument. If not set, no platform will be specified in the docker build.
PLATFORM=$1

# This simple script builds this 
#directory 's Dockerfile Image

# Set PROJECTPATH to the path of the current directory
PROJECTPATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Set PROJECT to the lowercase version of the name of this directory
PROJECT=`echo ${PROJECTPATH##*/}|awk '{print tolower($0)}'`
# Set FULL_BRANCH to the name of the current Git branch
FULL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Set BRANCH to the lowercase version of this name, with everything after the last forward slash removed
BRANCH=${FULL_BRANCH##*/}
# Set TAG to the output of the git describe --always --tag command, which returns a "unique identifier" for the current commit
TAG=$(git describe --always --tag)

# Print the values of the variables
echo PROJECTPATH=$PROJECTPATH
echo     PROJECT=$PROJECT
echo FULL_BRANCH=$FULL_BRANCH
echo      BRANCH=$BRANCH

# Check if PLATFORM is set and not empty
if [ -n "$PLATFORM" ]; then
    echo "Building with specified platform: $PLATFORM"
    PLATFORM_ARG="--platform $PLATFORM"
    BUILD_ARG="--build-arg PLATFORM=$PLATFORM"
    # If PLATFORM is set, build the prerequisites Dockerfile
    DOCKERFILE="-f Dockerfile.prerequisites"
    # Replace '/' with '-' in PLATFORM to create FLATPLATFORM
    FLATPLATFORM=$(echo "$PLATFORM" | tr '/' '-')
else
    echo "Building without specifying platform."
    PLATFORM_ARG=""
    BUILD_ARG=""
    # If PLATFORM is not set, build the default Dockerfile
    DOCKERFILE=""
    FLATPLATFORM="default"
fi

echo docker build -t openco/$PROJECT-$BRANCH:$TAG .
echo docker tag -f openco/$PROJECT-$BRANCH:$TAG openco/$PROJECT-$BRANCH:latest

# Build the Docker image
docker build $PLATFORM_ARG $BUILD_ARG \
  $DOCKERFILE \
  -t openco/$PROJECT-$BRANCH:$TAG \
  -t openco/$PROJECT-$BRANCH:$FLATPLATFORM \
  -t openco/$PROJECT-$BRANCH:latest \
  .
