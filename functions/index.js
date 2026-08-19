const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

exports.grantOwnerRoleOnFirstUserCreate = functions.auth.user().onCreate(async (user) => {
    const { uid } = user;
    
    try {
        const listUsersResult = await admin.auth().listUsers(10);
        
        if (listUsersResult.users.length === 1) {
            await admin.auth().setCustomUserClaims(uid, { role: 'owner' });
            
            const db = admin.firestore();
            await db.collection('users').doc(uid).update({ role: 'owner' });
            
            console.log(`Successfully granted 'owner' role to first user: ${uid}`);
            return { message: 'Owner role granted to the first user.' };
        }
        return { message: 'Not the first user, no special role granted.'};

    } catch (error) {
        console.error('Error in grantOwnerRoleOnFirstUserCreate:', error);
        return { error: error.message };
    }
});


exports.setUserRole = functions.https.onCall(async (data, context) => {
    if (context.auth.token.role !== 'owner') {
        return { error: 'Only owners can set user roles.' };
    }

    const { email, role } = data;

    try {
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(user.uid, { role: role });
        
        const db = admin.firestore();
        await db.collection('users').doc(user.uid).update({ role: role });

        return { message: `Success! ${email} has been made a ${role}.` };
    } catch (error) {
        return { error: error.message };
    }
});

exports.createClanAndSetLeader = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'owner') {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Only an owner can create clans and assign leaders.'
        );
    }

    const { clanName, leaderEmail } = data;
    if (!clanName || !leaderEmail) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'The function must be called with "clanName" and "leaderEmail" arguments.'
        );
    }

    const db = admin.firestore();

    try {
        const userRecord = await admin.auth().getUserByEmail(leaderEmail);
        const leaderUid = userRecord.uid;

        const clanRef = db.collection('clans').doc();
        const clanId = clanRef.id;
        
        const newClanData = {
            name: clanName,
            leader: leaderUid,
            members: {
                [leaderUid]: true
            }
        };
        await clanRef.set(newClanData);

        await db.collection('users').doc(leaderUid).update({ role: 'leader', clanId: clanId });

        await admin.auth().setCustomUserClaims(leaderUid, { role: 'leader', clanId: clanId });

        return { success: true, message: `Successfully created clan "${clanName}" and set ${leaderEmail} as leader.` };
    } catch (error) {
        console.error('Error in createClanAndSetLeader:', error);
        if (error.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', `User with email ${leaderEmail} does not exist.`);
        }
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while creating the clan.');
    }
});

exports.updateClanName = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { clanId, newName } = data;
    if (!clanId || !newName || newName.trim() === '') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'The function must be called with "clanId" and a non-empty "newName".'
        );
    }

    const db = admin.firestore();
    const clanRef = db.collection('clans').doc(clanId);
    const uid = context.auth.uid;

    try {
        const clanSnapshot = await clanRef.get();
        if (!clanSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', 'Clan not found.');
        }
        if (clanSnapshot.data().leader !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the clan leader can change the name.');
        }
        await clanRef.update({ name: newName });
        return { success: true, message: 'Clan name updated successfully.' };
    } catch (error) {
        console.error('Error updating clan name:', error);
        if (error.code) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'An error occurred while updating the clan name.');
    }
});
